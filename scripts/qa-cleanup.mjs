import fs from "node:fs";
import path from "node:path";
import { assertQaEnvironment, readEnv } from "./qa-env.mjs";
import { dbDelete } from "./lib/supabase-admin.mjs";

const envIndex = process.argv.indexOf("--env");
const runIndex = process.argv.indexOf("--run");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
const runId = runIndex >= 0 ? process.argv[runIndex + 1] : undefined;
if (!envPath) throw new Error("--env requires a path.");
if (!runId) throw new Error("--run is required.");
const env = readEnv(envPath);
assertQaEnvironment(env);

const manifestPath = path.join(".qa-fixtures", `${runId}.json`);
if (!fs.existsSync(manifestPath)) throw new Error(`Fixture manifest not found: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.runId !== runId || manifest.namespace !== env.QA_RUN_NAMESPACE) {
  throw new Error("Fixture manifest does not belong to the active QA namespace.");
}

const deletionOrder = [
  "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  "TEABLE_FLASHCARDS_TABLE_ID",
  "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID",
  "TEABLE_CORRECTIONS_TABLE_ID",
  "TEABLE_MESSAGES_TABLE_ID",
  "TEABLE_APP_EVENTS_TABLE_ID",
  "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID",
  "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_TOPICS_TABLE_ID",
  "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
  "TEABLE_USERS_TABLE_ID"
];

for (const tableEnvName of deletionOrder) {
  // The fixture scopes data under the persistent QA auth user; its users row
  // is never deleted (only throwaway legacy fixture users were).
  if (tableEnvName === "TEABLE_USERS_TABLE_ID" && manifest.keepQaUser) continue;
  for (const recordId of manifest.records[tableEnvName] ?? []) {
    await dbDelete(env, tableEnvName, recordId);
  }
}

fs.rmSync(manifestPath);
console.log(`QA fixture cleaned: ${runId}.`);
