import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const userId = option("--user-id");
const profileId = option("--profile-id");
const confirmation = option("--confirm");
if (!userId || !profileId) throw new Error("Use --user-id and --profile-id.");
if (confirmation !== "RESET_PERSONAL_TEST_DATA") {
  throw new Error("Use --confirm RESET_PERSONAL_TEST_DATA after creating a backup.");
}

const env = readEnv(envPath);
if (env.APP_ENV === "production") throw new Error("This reset tool refuses APP_ENV=production.");
const tableId = (name) => required(env, name);
const list = async (name, take = 1000) => recordsFrom(
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

const deletionOrder = [
  "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  "TEABLE_FLASHCARDS_TABLE_ID",
  "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  "TEABLE_CORRECTIONS_TABLE_ID",
  "TEABLE_MESSAGES_TABLE_ID",
  "TEABLE_APP_EVENTS_TABLE_ID",
  "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
  "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  "TEABLE_WORDS_TABLE_ID",
  "TEABLE_CONVERSATIONS_TABLE_ID",
  "TEABLE_TOPICS_TABLE_ID"
];
const deleted = {};

for (const tableName of deletionOrder) {
  const records = await list(tableName);
  for (const record of records) {
    await teableRequest(
      env,
      `/api/table/${tableId(tableName)}/record/${record.id}?fieldKeyType=name`,
      { method: "DELETE" }
    );
  }
  deleted[tableName] = records.length;
}

const orphanProfiles = profiles.filter((record) => record.id !== profileId);
for (const record of orphanProfiles) {
  await teableRequest(
    env,
    `/api/table/${tableId("TEABLE_LANGUAGE_PROFILES_TABLE_ID")}/record/${record.id}?fieldKeyType=name`,
    { method: "DELETE" }
  );
}
deleted.TEABLE_LANGUAGE_PROFILES_TABLE_ID = orphanProfiles.length;

const extraUsers = users.filter((record) => record.id !== userId && (record.fields?.Name || record.fields?.created_at));
for (const record of extraUsers) {
  await teableRequest(
    env,
    `/api/table/${tableId("TEABLE_USERS_TABLE_ID")}/record/${record.id}?fieldKeyType=name`,
    { method: "DELETE" }
  );
}
deleted.TEABLE_USERS_TABLE_ID = extraUsers.length;

console.log(JSON.stringify({
  ok: true,
  preserved: { userId, profileId },
  deleted
}, null, 2));
