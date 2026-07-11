import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const env = readEnv(envPath);
const tableId = (name) => required(env, name);
const list = async (name, take = 500) => recordsFrom(
  await teableRequest(env, `/api/table/${tableId(name)}/record?take=${take}&fieldKeyType=name`)
);

const [users, profiles] = await Promise.all([
  list("TEABLE_USERS_TABLE_ID", 100),
  list("TEABLE_LANGUAGE_PROFILES_TABLE_ID", 100)
]);

const scopedTables = [
  "TEABLE_TOPICS_TABLE_ID",
  "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  "TEABLE_PRACTICE_SESSIONS_TABLE_ID"
];
const tables = {};

for (const tableName of scopedTables) {
  const records = await list(tableName);
  tables[tableName] = {
    total: records.length,
    missingUser: records.filter((record) => !String(record.fields?.user_id ?? "").trim()).length,
    missingProfile: records.filter((record) => !String(record.fields?.language_profile_id ?? "").trim()).length,
    byUser: countBy(records, (record) => String(record.fields?.user_id ?? "unscoped")),
    byProfile: countBy(records, (record) => String(record.fields?.language_profile_id ?? "unscoped"))
  };
}

for (const tableName of [
  "TEABLE_MESSAGES_TABLE_ID",
  "TEABLE_CORRECTIONS_TABLE_ID",
  "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID",
  "TEABLE_APP_EVENTS_TABLE_ID"
]) {
  const records = await list(tableName);
  tables[tableName] = { total: records.length };
}

console.log(JSON.stringify({
  ok: true,
  environment: env.APP_ENV ?? "unknown",
  users: users
    .filter((record) => record.fields?.Name || record.fields?.created_at)
    .map((record) => ({
      id: record.id,
      name: record.fields?.Name ?? record.fields?.name ?? "",
      activeLanguageId: record.fields?.active_language_id ?? "",
      createdAt: record.fields?.created_at ?? record.createdTime ?? ""
    })),
  profiles: profiles
    .filter((record) => record.fields?.user_id || record.fields?.language_code)
    .map((record) => ({
      id: record.id,
      userId: record.fields?.user_id ?? "",
      languageCode: record.fields?.language_code ?? "",
      languageName: record.fields?.language_name ?? "",
      level: record.fields?.level ?? ""
    })),
  tables
}, null, 2));

function countBy(records, keyFor) {
  const counts = {};
  for (const record of records) {
    const key = keyFor(record) || "unscoped";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
