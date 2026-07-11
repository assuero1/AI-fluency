import { getTeableConfig } from "./config";
import { getSchemaTable, TeableTableKey } from "./schema";

export type TeableRecord<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  fields: TFields;
  createdTime?: string;
};

export type TeableListResponse<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  records?: TeableRecord<TFields>[];
  data?: {
    records?: TeableRecord<TFields>[];
  };
};

export type TeableCreateResponse<TFields extends Record<string, unknown> = Record<string, unknown>> =
  | TeableRecord<TFields>
  | {
      records?: TeableRecord<TFields>[];
      data?: {
        records?: TeableRecord<TFields>[];
      };
    };

export class TeableConfigError extends Error {
  status = 503;
}

export class TeableRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export class TeableClient {
  private baseUrl: string;
  private apiKey: string;
  private healthTableId?: string;
  private tableIds: ReturnType<typeof getTeableConfig>["tableIds"];

  constructor() {
    const config = getTeableConfig();
    if (!config.baseUrl) throw new TeableConfigError("TEABLE_BASE_URL is not configured.");
    if (!config.apiKey) throw new TeableConfigError("TEABLE_API_KEY or TEABLE_TOKEN is not configured.");

    this.baseUrl = trimSlash(config.baseUrl);
    this.apiKey = config.apiKey;
    this.healthTableId = config.healthTableId;
    this.tableIds = config.tableIds;
  }

  private tableId(tableKey: TeableTableKey) {
    const id = this.tableIds[tableKey];
    if (!id) {
      const schemaTable = getSchemaTable(tableKey);
      throw new TeableConfigError(
        `${schemaTable?.envName ?? tableKey} is not configured. Add the Teable table id to .env.local.`
      );
    }
    return id;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      throw new TeableRequestError(`Teable request failed: ${response.status}`, response.status, body);
    }

    return body as T;
  }

  async healthcheck() {
    const candidates = [
      this.healthTableId
        ? `/api/table/${encodeURIComponent(this.healthTableId)}/record?take=1&fieldKeyType=name`
        : undefined,
      "/api/auth/session",
      "/api/user/me",
      "/api/user"
    ].filter(Boolean) as string[];

    const attempts: Array<{ path: string; status?: number; ok: boolean }> = [];

    for (const path of candidates) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        cache: "no-store"
      }).catch((error: unknown) => {
        attempts.push({ path: safeHealthPath(path), ok: false });
        throw error;
      });

      attempts.push({ path: safeHealthPath(path), status: response.status, ok: response.ok });

      if (response.ok) {
        return {
          reachable: true,
          authenticatedEndpoint: true,
          attempts
        };
      }
    }

    throw new TeableRequestError("Teable is reachable, but no health candidate returned OK.", attempts.at(-1)?.status ?? 502, {
      attempts
    });
  }

  async listRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, take = 20) {
    const tableId = this.tableId(tableKey);
    const result = await this.request<TeableListResponse<TFields>>(
      `/api/table/${encodeURIComponent(tableId)}/record?take=${take}&fieldKeyType=name`
    );
    return result.records ?? result.data?.records ?? [];
  }

  async listAllRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey) {
    const tableId = this.tableId(tableKey);
    const records: TeableRecord<TFields>[] = [];
    const pageSize = 1000;
    for (let skip = 0; ; skip += pageSize) {
      const result = await this.request<TeableListResponse<TFields>>(
        `/api/table/${encodeURIComponent(tableId)}/record?take=${pageSize}&skip=${skip}&fieldKeyType=name`
      );
      const page = result.records ?? result.data?.records ?? [];
      records.push(...page);
      if (page.length < pageSize) return records;
    }
  }

  async createRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    fields: TFields
  ) {
    const tableId = this.tableId(tableKey);
    const result = await this.request<TeableCreateResponse<TFields>>(
      `/api/table/${encodeURIComponent(tableId)}/record?fieldKeyType=name`,
      {
        method: "POST",
        body: JSON.stringify({ records: [{ fields }] })
      }
    );

    if ("id" in result) return result;

    const record = result.records?.[0] ?? result.data?.records?.[0];
    if (!record) {
      throw new TeableRequestError("Teable did not return the created record.", 502, result);
    }

    return record;
  }

  async updateRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    recordId: string,
    fields: Partial<TFields>
  ) {
    const tableId = this.tableId(tableKey);
    return this.request<TeableRecord<TFields>>(
      `/api/table/${encodeURIComponent(tableId)}/record/${encodeURIComponent(recordId)}?fieldKeyType=name`,
      {
        method: "PATCH",
        body: JSON.stringify({ record: { fields } })
      }
    );
  }

  async deleteRecord(tableKey: TeableTableKey, recordId: string) {
    const tableId = this.tableId(tableKey);
    return this.request<unknown>(
      `/api/table/${encodeURIComponent(tableId)}/record/${encodeURIComponent(recordId)}?fieldKeyType=name`,
      { method: "DELETE" }
    );
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

export async function safeUpdateRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
  tableKey: TeableTableKey,
  recordId: string,
  fields: Partial<TFields>
) {
  try {
    return await getTeableClient().updateRecord<TFields>(tableKey, recordId, fields);
  } catch {
    return null;
  }
}

function safeHealthPath(path: string) {
  return path.replace(/\/api\/table\/[^/]+/, "/api/table/[id]");
}

export function getTeableClient() {
  return new TeableClient();
}
