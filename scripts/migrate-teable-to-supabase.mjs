import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

const TABLE_ENV = {
  users: "TEABLE_USERS_TABLE_ID",
  languageProfiles: "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
  aiProviderSettings: "TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID",
  voiceProviderSettings: "TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID",
  conversations: "TEABLE_CONVERSATIONS_TABLE_ID",
  messages: "TEABLE_MESSAGES_TABLE_ID",
  corrections: "TEABLE_CORRECTIONS_TABLE_ID",
  words: "TEABLE_WORDS_TABLE_ID",
  wordSenses: "TEABLE_WORD_SENSES_TABLE_ID",
  wordOccurrences: "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  wordUsageSummaries: "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID",
  dailyFeedbacks: "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  topics: "TEABLE_TOPICS_TABLE_ID",
  practiceSessions: "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
  flashcards: "TEABLE_FLASHCARDS_TABLE_ID",
  flashcardAttempts: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  appEvents: "TEABLE_APP_EVENTS_TABLE_ID"
};

// Teable primary field `Name`: only `users` has a counterpart column (`name`)
// in the Supabase schema; for every other table it is a record title with no
// target column and is dropped.
const RENAME_COLUMNS = { users: { Name: "name" } };
const DROP_COLUMNS = new Set(["Name"]);

function resolveColumn(meta, column) {
  const renamed = RENAME_COLUMNS[meta.tableName]?.[column];
  if (renamed) return renamed;
  if (DROP_COLUMNS.has(column)) return null;
  return column;
}

const PAGE_SIZE = 1000;
const BATCH = 200;
const date = new Date().toISOString().slice(0, 10);
const warnings = [];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const env = readEnv(option("--env") ?? ".env.local");
const supabase = createClient(required(env, "SUPABASE_URL"), required(env, "SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function listAllTeable(tableId) {
  const all = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const result = await teableRequest(env, `/api/table/${tableId}/record?take=${PAGE_SIZE}&skip=${skip}&fieldKeyType=name`);
    const page = recordsFrom(result);
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

function toRow(meta, fields, { skipForeignKeys }) {
  const jsonb = new Set(meta.jsonbColumns);
  const foreignKeys = new Set(Object.keys(meta.fkColumns));
  const row = {};
  for (const [rawColumn, value] of Object.entries(fields)) {
    const column = resolveColumn(meta, rawColumn);
    if (column === null) continue;
    if (value === undefined) continue;
    if (skipForeignKeys && foreignKeys.has(column)) continue;
    if (value === "") {
      row[column] = null;
      continue;
    }
    if (jsonb.has(column) && typeof value === "string") {
      try {
        row[column] = JSON.parse(value);
      } catch {
        row[column] = null;
        warnings.push(`${meta.tableName}.${column}: invalid JSON string stored as null (${String(value).slice(0, 60)})`);
      }
      continue;
    }
    row[column] = value;
  }
  return row;
}

// Postgres jsonb does not preserve key order, so compare canonical forms.
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function valuesEqual(column, meta, teableValue, supabaseValue, idMap) {
  const empty = (v) => v === undefined || v === null || v === "";
  if (empty(teableValue) && empty(supabaseValue)) return true;
  if (column in meta.fkColumns) {
    const expected = empty(teableValue) ? null : idMap[meta.fkColumns[column]]?.[teableValue] ?? null;
    return expected === supabaseValue;
  }
  if (meta.jsonbColumns.includes(column)) {
    try {
      const parsed = typeof teableValue === "string" ? JSON.parse(teableValue) : teableValue;
      return JSON.stringify(canonicalJson(parsed)) === JSON.stringify(canonicalJson(supabaseValue));
    } catch {
      return supabaseValue === null;
    }
  }
  if (typeof supabaseValue === "number" || typeof teableValue === "number") {
    return Number(teableValue) === Number(supabaseValue);
  }
  if (/(_at|^date)$/.test(column) && teableValue && supabaseValue) {
    return Date.parse(teableValue) === Date.parse(supabaseValue);
  }
  return teableValue === supabaseValue;
}

// ---------- Preflight ----------
for (const meta of tablesJson.tables) {
  const { count, error } = await supabase.from(meta.tableName).select("id", { count: "exact", head: true });
  if (error) throw new Error(`Supabase table ${meta.tableName} not reachable: ${error.message}. Rode a Task 7 primeiro.`);
  if (count && count > 0) {
    throw new Error(`Supabase table ${meta.tableName} is not empty (${count} rows). Limpe manualmente antes de re-rodar.`);
  }
}

// ---------- Passada 1: insert sem FKs ----------
const idMap = {};
const teableData = {};
for (const meta of tablesJson.tables) {
  const records = await listAllTeable(required(env, TABLE_ENV[meta.key]));
  teableData[meta.key] = records;
  idMap[meta.tableName] = {};
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const rows = batch.map((record) => {
      const row = toRow(meta, record.fields ?? {}, { skipForeignKeys: true });
      row.legacy_id = record.id;
      if (meta.hasCreatedAt && row.created_at === undefined && record.createdTime) {
        row.created_at = record.createdTime;
      }
      return row;
    });
    if (rows.length === 0) continue;
    const { data, error } = await supabase.from(meta.tableName).insert(rows).select("id, legacy_id");
    if (error) throw new Error(`Insert failed on ${meta.tableName} (batch ${i / BATCH}): ${error.message}`);
    for (const inserted of data) idMap[meta.tableName][inserted.legacy_id] = inserted.id;
  }
  console.log(`pass1 ${meta.tableName}: ${records.length} records`);
}

fs.writeFileSync(path.resolve(`backups/supabase-id-map-${date}.json`), `${JSON.stringify(idMap, null, 2)}\n`, { mode: 0o600 });

// ---------- Passada 2: resolver FKs ----------
for (const meta of tablesJson.tables) {
  const records = teableData[meta.key];
  for (const record of records) {
    const updates = {};
    for (const [column, targetTable] of Object.entries(meta.fkColumns)) {
      const legacyRef = record.fields?.[column];
      if (legacyRef === undefined || legacyRef === null || legacyRef === "") continue;
      const uuid = idMap[targetTable]?.[legacyRef];
      if (uuid) {
        updates[column] = uuid;
      } else {
        warnings.push(`${meta.tableName}.${column}: orphaned reference ${legacyRef} (record ${record.id}) -> null`);
      }
    }
    if (Object.keys(updates).length === 0) continue;
    const { error } = await supabase.from(meta.tableName).update(updates).eq("legacy_id", record.id);
    if (error) throw new Error(`FK update failed on ${meta.tableName} record ${record.id}: ${error.message}`);
  }
  console.log(`pass2 ${meta.tableName}: FKs resolved`);
}

// ---------- Verificação ----------
const report = { createdAt: new Date().toISOString(), tables: {}, warnings, ok: true };
let failures = 0;
for (const meta of tablesJson.tables) {
  const records = teableData[meta.key];
  const { count } = await supabase.from(meta.tableName).select("id", { count: "exact", head: true });
  const countOk = count === records.length;
  if (!countOk) failures++;

  const sample = [...records].sort(() => Math.random() - 0.5).slice(0, Math.min(5, records.length));
  const sampleMismatches = [];
  for (const record of sample) {
    const { data, error } = await supabase.from(meta.tableName).select("*").eq("legacy_id", record.id).limit(1);
    const row = data?.[0];
    if (error || !row) {
      sampleMismatches.push({ legacyId: record.id, error: error?.message ?? "row not found" });
      continue;
    }
    for (const [rawColumn, value] of Object.entries(record.fields ?? {})) {
      const column = resolveColumn(meta, rawColumn);
      if (column === null) continue;
      if (!valuesEqual(column, meta, value, row[column], idMap)) {
        sampleMismatches.push({ legacyId: record.id, column, teable: value, supabase: row[column] });
      }
    }
  }
  if (sampleMismatches.length > 0) failures++;
  report.tables[meta.tableName] = { teable: records.length, supabase: count, countOk, sampleMismatches };
  console.log(`verify ${meta.tableName}: teable=${records.length} supabase=${count} sampleMismatches=${sampleMismatches.length}`);
}

report.ok = failures === 0;
fs.writeFileSync(path.resolve(`backups/supabase-migration-report-${date}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

const personalUserId = env.AI_FLUENCY_USER_ID;
if (personalUserId && idMap.users?.[personalUserId]) {
  console.log(`\nAÇÃO NECESSÁRIA: atualize AI_FLUENCY_USER_ID no .env.local de ${personalUserId} para ${idMap.users[personalUserId]}`);
}

console.log(`\nMigração ${report.ok ? "OK" : "FALHOU"} — relatório: backups/supabase-migration-report-${date}.json`);
process.exit(report.ok ? 0 : 1);
