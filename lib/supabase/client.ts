import { createClient, type SupabaseClient as SupabaseJsClient } from "@supabase/supabase-js";
import type { TeableTableKey } from "@/lib/teable/schema";
import { TeableConfigError, TeableRequestError, type TeableRecord } from "@/lib/teable/types";
import { getSupabaseConfig } from "./config";
import tablesJson from "./tables.json";

type TableMeta = {
  key: string;
  tableName: string;
  jsonbColumns: string[];
  fkColumns: Record<string, string>;
  hasCreatedAt: boolean;
};

// resolveJsonModule infers exact per-row shapes (with optional `undefined`
// props), so normalize through unknown to the runtime TableMeta contract.
const TABLES = tablesJson.tables as unknown as TableMeta[];

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSIENT_ERROR = /fetch failed|timed out|timeout|network|ECONNRESET|ETIMEDOUT|AbortError/i;

function tableMeta(tableKey: TeableTableKey): TableMeta {
  const meta = TABLES.find((table) => table.key === tableKey);
  if (!meta) throw new TeableConfigError(`Unknown table key: ${tableKey}`);
  return meta;
}

function withTimeoutSignal(signal?: AbortSignal | null) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class SupabaseTeableClient {
  private db: SupabaseJsClient;

  constructor() {
    const config = getSupabaseConfig();
    if (!config.url) throw new TeableConfigError("SUPABASE_URL is not configured.");
    if (!config.serviceRoleKey) throw new TeableConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    this.db = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      // postgrest-js 2.112 retries GET/HEAD/OPTIONS internally by default (up to
      // 3 retries, including HTTP 503/520). Disable it: the adapter already does
      // its own single retry on transient failures, mirroring TeableClient.
      db: { retry: false },
      global: {
        fetch: (url, init) => fetch(url, { ...init, signal: withTimeoutSignal(init?.signal ?? null) })
      }
    });
  }

  private toRecord<TFields extends Record<string, unknown>>(meta: TableMeta, row: Record<string, unknown>): TeableRecord<TFields> {
    const jsonb = new Set(meta.jsonbColumns);
    const fields: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      if (column === "id" || column === "legacy_id") continue;
      fields[column] = jsonb.has(column) && value !== null && typeof value !== "string" ? JSON.stringify(value) : value;
    }
    const record: TeableRecord<TFields> = { id: String(row.id), fields: fields as TFields };
    if (typeof row.created_at === "string") record.createdTime = row.created_at;
    return record;
  }

  private toRow(meta: TableMeta, fields: Record<string, unknown>): Record<string, unknown> {
    const jsonb = new Set(meta.jsonbColumns);
    const row: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (value === "") {
        row[column] = null;
        continue;
      }
      if (jsonb.has(column) && typeof value === "string") {
        try {
          row[column] = JSON.parse(value);
        } catch {
          throw new TeableRequestError(`Invalid JSON string for column ${meta.tableName}.${column}.`, 400, value);
        }
        continue;
      }
      row[column] = value;
    }
    return row;
  }

  private unwrap<T>(result: { data: T | null; error: { message?: string; code?: string } | null }, context: string): T {
    if (result.error) {
      // Map PostgREST/Postgres error codes so idempotent-create recovery paths
      // (which branch on 409/404) keep working against the Supabase backend.
      const status = result.error.code === "23505" ? 409 : result.error.code === "PGRST116" ? 404 : 502;
      throw new TeableRequestError(`Supabase ${context} failed: ${result.error.message ?? "unknown error"}`, status, result.error);
    }
    return result.data as T;
  }

  // Idempotent reads get one retry on transient network/timeout failures,
  // mirroring TeableClient. Writes are never retried.
  private async read<T>(context: string, run: () => PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>): Promise<T> {
    let result = await run();
    if (result.error && TRANSIENT_ERROR.test(result.error.message ?? "")) {
      result = await run();
    }
    return this.unwrap(result, context);
  }

  private idColumn(recordId: string) {
    return UUID_PATTERN.test(recordId) ? "id" : "legacy_id";
  }

  async healthcheck() {
    const meta = tableMeta("users");
    const result = await this.db.from(meta.tableName).select("id").limit(1);
    const attempts = [{ path: `rest/v1/${meta.tableName}`, status: result.error ? 502 : 200, ok: !result.error }];
    if (result.error) {
      throw new TeableRequestError("Supabase health query failed.", 502, { attempts, error: result.error });
    }
    return { reachable: true, authenticatedEndpoint: true, attempts };
  }

  async listRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, take = 20) {
    const meta = tableMeta(tableKey);
    const rows = await this.read("listRecords", () => this.db.from(meta.tableName).select("*").order("id").limit(take));
    return (rows ?? []).map((row) => this.toRecord<TFields>(meta, row as Record<string, unknown>));
  }

  async listAllRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey) {
    const meta = tableMeta(tableKey);
    const records: TeableRecord<TFields>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const rows = await this.read("listAllRecords", () =>
        this.db.from(meta.tableName).select("*").order("id").range(from, from + PAGE_SIZE - 1)
      );
      const page = (rows ?? []) as Array<Record<string, unknown>>;
      records.push(...page.map((row) => this.toRecord<TFields>(meta, row)));
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async listRecordsWhere<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    field: string,
    value: string
  ) {
    return this.listRecordsWhereAll<TFields>(tableKey, [{ field, value }]);
  }

  async listRecordsWhereAll<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    filters: Array<{ field: string; value: string }>
  ) {
    const meta = tableMeta(tableKey);
    const records: TeableRecord<TFields>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const rows = await this.read("listRecordsWhereAll", () => {
        let query = this.db.from(meta.tableName).select("*").order("id").range(from, from + PAGE_SIZE - 1);
        for (const { field, value } of filters) {
          if (value === "") {
            query = query.is(field, null);
          } else if (field === "id" && !UUID_PATTERN.test(value)) {
            query = query.eq("legacy_id", value);
          } else {
            query = query.eq(field, value);
          }
        }
        return query;
      });
      const page = (rows ?? []) as Array<Record<string, unknown>>;
      records.push(...page.map((row) => this.toRecord<TFields>(meta, row)));
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async getRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, recordId: string) {
    const meta = tableMeta(tableKey);
    const rows = await this.read("getRecord", () =>
      this.db.from(meta.tableName).select("*").eq(this.idColumn(recordId), recordId).limit(1)
    );
    const row = (rows as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new TeableRequestError(`Supabase record not found in ${meta.tableName}: ${recordId}`, 404);
    }
    return this.toRecord<TFields>(meta, row);
  }

  async createRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    fields: TFields
  ) {
    const meta = tableMeta(tableKey);
    const inserted = this.unwrap<Record<string, unknown>>(
      await this.db.from(meta.tableName).insert(this.toRow(meta, fields)).select("*").single(),
      "createRecord"
    );
    return this.toRecord<TFields>(meta, inserted);
  }

  async updateRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    recordId: string,
    fields: Partial<TFields>
  ) {
    const meta = tableMeta(tableKey);
    const updated = this.unwrap<Record<string, unknown>>(
      await this.db.from(meta.tableName).update(this.toRow(meta, fields)).eq(this.idColumn(recordId), recordId).select("*").single(),
      "updateRecord"
    );
    return this.toRecord<TFields>(meta, updated);
  }

  async deleteRecord(tableKey: TeableTableKey, recordId: string) {
    const meta = tableMeta(tableKey);
    this.unwrap(
      await this.db.from(meta.tableName).delete().eq(this.idColumn(recordId), recordId),
      "deleteRecord"
    );
    return { deleted: true };
  }

  async createEvent(userId: string | undefined, eventName: string, payload: Record<string, unknown>) {
    return this.createRecord("appEvents", {
      user_id: userId ?? "",
      event_name: eventName,
      payload: JSON.stringify(payload),
      created_at: new Date().toISOString()
    });
  }
}

export function createSupabaseTeableClient() {
  return new SupabaseTeableClient();
}
