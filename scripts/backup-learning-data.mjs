import fs from "node:fs";
import path from "node:path";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const outputPath = option("--out");
if (!outputPath) throw new Error("Use --out with a local JSON backup path.");

const env = readEnv(envPath);
const tableId = (name) => required(env, name);
const tableNames = [
  "TEABLE_USERS_TABLE_ID",
  "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
  "TEABLE_TOPICS_TABLE_ID",
  "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_MESSAGES_TABLE_ID",
  "TEABLE_CORRECTIONS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID",
  "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
  "TEABLE_FLASHCARDS_TABLE_ID",
  "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  "TEABLE_APP_EVENTS_TABLE_ID"
];
const tables = {};

for (const tableName of tableNames) {
  const result = await teableRequest(
    env,
    `/api/table/${tableId(tableName)}/record?take=1000&fieldKeyType=name`
  );
  tables[tableName] = recordsFrom(result);
}

const backup = {
  version: 1,
  createdAt: new Date().toISOString(),
  sourceEnvironment: env.APP_ENV ?? "unknown",
  tables
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  ok: true,
  outputPath,
  records: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))
}, null, 2));
