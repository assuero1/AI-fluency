import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const userId = option("--user-id");
const profileId = option("--profile-id");
const apply = process.argv.includes("--apply");

if (!userId || !profileId) {
  throw new Error("Use --user-id and --profile-id to select the exact personal learning scope.");
}

const env = readEnv(envPath);
const tableId = (name) => required(env, name);
const list = async (name, take = 500) => recordsFrom(
  await teableRequest(env, `/api/table/${tableId(name)}/record?take=${take}&fieldKeyType=name`)
);

const [users, profiles] = await Promise.all([
  list("TEABLE_USERS_TABLE_ID", 100),
  list("TEABLE_LANGUAGE_PROFILES_TABLE_ID", 100)
]);
const user = users.find((record) => record.id === userId);
const profile = profiles.find((record) => record.id === profileId && record.fields?.user_id === userId);
if (!user) throw new Error(`User ${userId} was not found.`);
if (!profile) throw new Error(`Profile ${profileId} was not found for user ${userId}.`);

const scopedTables = [
  "TEABLE_TOPICS_TABLE_ID",
  "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  "TEABLE_PRACTICE_SESSIONS_TABLE_ID"
];
const report = {};

for (const tableName of scopedTables) {
  const records = await list(tableName);
  const candidates = [];
  const conflicts = [];

  for (const record of records) {
    const recordUserId = String(record.fields?.user_id ?? "").trim();
    const recordProfileId = String(record.fields?.language_profile_id ?? "").trim();
    const conflictsWithTarget =
      (recordUserId && recordUserId !== userId) ||
      (recordProfileId && recordProfileId !== profileId);

    if (conflictsWithTarget) {
      conflicts.push(record.id);
      continue;
    }
    if (!recordUserId || !recordProfileId) candidates.push(record);
  }

  if (apply) {
    for (const record of candidates) {
      await teableRequest(
        env,
        `/api/table/${tableId(tableName)}/record/${record.id}?fieldKeyType=name`,
        {
          method: "PATCH",
          body: JSON.stringify({
            record: {
              fields: {
                ...(!record.fields?.user_id ? { user_id: userId } : {}),
                ...(!record.fields?.language_profile_id ? { language_profile_id: profileId } : {})
              }
            }
          })
        }
      );
    }
  }

  report[tableName] = {
    scanned: records.length,
    candidates: candidates.length,
    updated: apply ? candidates.length : 0,
    conflicts: conflicts.length,
    conflictSample: conflicts.slice(0, 10)
  };
}

console.log(JSON.stringify({
  ok: true,
  mode: apply ? "apply" : "dry-run",
  userId,
  profileId,
  report
}, null, 2));
