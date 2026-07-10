import fs from "node:fs";
import path from "node:path";
import { assertQaEnvironment, readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

const envIndex = process.argv.indexOf("--env");
const runIndex = process.argv.indexOf("--run");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
const runId = runIndex >= 0 ? process.argv[runIndex + 1] : undefined;
if (!envPath) throw new Error("--env requires a path.");
if (!runId?.startsWith("qa-")) throw new Error("--run must be a QA fixture id.");

const env = readEnv(envPath);
assertQaEnvironment(env);
const tableId = (name) => required(env, name);
const list = async (name) => recordsFrom(await teableRequest(env, `/api/table/${tableId(name)}/record?take=100&fieldKeyType=name`));
const manifestPath = path.join(".qa-fixtures", `${runId}.json`);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
const records = {};
for (const name of [
  "TEABLE_USERS_TABLE_ID", "TEABLE_LANGUAGE_PROFILES_TABLE_ID", "TEABLE_TOPICS_TABLE_ID", "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID", "TEABLE_MESSAGES_TABLE_ID", "TEABLE_CORRECTIONS_TABLE_ID", "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID", "TEABLE_PRACTICE_SESSIONS_TABLE_ID", "TEABLE_APP_EVENTS_TABLE_ID"
]) records[name] = await list(name);

const userIds = new Set([
  ...(manifest?.records?.TEABLE_USERS_TABLE_ID ?? []),
  ...records.TEABLE_USERS_TABLE_ID.filter((record) => record.fields?.Name?.includes(runId)).map((record) => record.id)
]);
const profileIds = new Set(records.TEABLE_LANGUAGE_PROFILES_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)).map((record) => record.id));
const conversationIds = new Set(records.TEABLE_CONVERSATIONS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)).map((record) => record.id));
const wordIds = new Set(records.TEABLE_WORDS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)).map((record) => record.id));
const messageIds = new Set(records.TEABLE_MESSAGES_TABLE_ID.filter((record) => conversationIds.has(record.fields?.conversation_id)).map((record) => record.id));

const selected = {
  TEABLE_WORD_OCCURRENCES_TABLE_ID: records.TEABLE_WORD_OCCURRENCES_TABLE_ID.filter((record) => wordIds.has(record.fields?.word_id) || conversationIds.has(record.fields?.conversation_id)),
  TEABLE_CORRECTIONS_TABLE_ID: records.TEABLE_CORRECTIONS_TABLE_ID.filter((record) => conversationIds.has(record.fields?.conversation_id) || messageIds.has(record.fields?.message_id)),
  TEABLE_MESSAGES_TABLE_ID: records.TEABLE_MESSAGES_TABLE_ID.filter((record) => conversationIds.has(record.fields?.conversation_id)),
  TEABLE_APP_EVENTS_TABLE_ID: records.TEABLE_APP_EVENTS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)),
  TEABLE_PRACTICE_SESSIONS_TABLE_ID: records.TEABLE_PRACTICE_SESSIONS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id) || conversationIds.has(record.fields?.conversation_id)),
  TEABLE_DAILY_FEEDBACKS_TABLE_ID: records.TEABLE_DAILY_FEEDBACKS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)),
  TEABLE_WORDS_TABLE_ID: records.TEABLE_WORDS_TABLE_ID.filter((record) => wordIds.has(record.id)),
  TEABLE_CONVERSATIONS_TABLE_ID: records.TEABLE_CONVERSATIONS_TABLE_ID.filter((record) => conversationIds.has(record.id)),
  TEABLE_TOPICS_TABLE_ID: records.TEABLE_TOPICS_TABLE_ID.filter((record) => userIds.has(record.fields?.user_id)),
  TEABLE_LANGUAGE_PROFILES_TABLE_ID: records.TEABLE_LANGUAGE_PROFILES_TABLE_ID.filter((record) => profileIds.has(record.id)),
  TEABLE_USERS_TABLE_ID: records.TEABLE_USERS_TABLE_ID.filter((record) => userIds.has(record.id))
};

for (const [name, rows] of Object.entries(selected)) {
  for (const record of rows) await teableRequest(env, `/api/table/${tableId(name)}/record/${record.id}?fieldKeyType=name`, { method: "DELETE" });
}

if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
console.log(`Recovered ${Object.values(selected).reduce((total, rows) => total + rows.length, 0)} fixture records for ${runId}.`);
