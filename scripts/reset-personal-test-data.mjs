import { readEnv } from "./qa-env.mjs";
import { dbDelete, dbListAll } from "./lib/supabase-admin.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const userId = option("--user-id");
const profileId = option("--profile-id");
const confirmation = option("--confirm");
if (!userId || !profileId) throw new Error("Use --user-id and --profile-id.");

const env = readEnv(envPath);
// Defense-in-depth only: .env.local may say APP_ENV=development while pointing
// at the production Supabase project, so the real guard is the project-scoped
// confirmation token below.
if (env.APP_ENV === "production") throw new Error("This reset tool refuses APP_ENV=production.");
if (!env.SUPABASE_URL) throw new Error(`SUPABASE_URL is missing in ${envPath}.`);

const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];
const expectedToken = `RESET_PERSONAL_TEST_DATA_${projectRef}`;
if (confirmation !== expectedToken) {
  throw new Error(
    `Refusing to wipe ${env.SUPABASE_URL}. Use --confirm ${expectedToken} after creating a backup.`
  );
}

const list = (name) => dbListAll(env, name);

const [users, profiles] = await Promise.all([
  list("TEABLE_USERS_TABLE_ID"),
  list("TEABLE_LANGUAGE_PROFILES_TABLE_ID")
]);
const user = users.find((record) => record.id === userId);
const profile = profiles.find((record) => record.id === profileId && record.fields?.user_id === userId);
if (!user) throw new Error(`User ${userId} was not found.`);
if (!profile) throw new Error(`Profile ${profileId} was not found for user ${userId}.`);

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
  "TEABLE_TOPICS_TABLE_ID"
];
const deleted = {};

for (const tableName of deletionOrder) {
  const records = await list(tableName);
  for (const record of records) {
    await dbDelete(env, tableName, record.id);
  }
  deleted[tableName] = records.length;
}

const orphanProfiles = profiles.filter((record) => record.id !== profileId);
for (const record of orphanProfiles) {
  await dbDelete(env, "TEABLE_LANGUAGE_PROFILES_TABLE_ID", record.id);
}
deleted.TEABLE_LANGUAGE_PROFILES_TABLE_ID = orphanProfiles.length;

const extraUsers = users.filter((record) => record.id !== userId && (record.fields?.Name || record.fields?.created_at));
for (const record of extraUsers) {
  await dbDelete(env, "TEABLE_USERS_TABLE_ID", record.id);
}
deleted.TEABLE_USERS_TABLE_ID = extraUsers.length;

console.log(JSON.stringify({
  ok: true,
  preserved: { userId, profileId },
  deleted
}, null, 2));
