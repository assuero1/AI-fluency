import { createClient } from "@supabase/supabase-js";
import tablesJson from "../../lib/supabase/tables.json" with { type: "json" };

const ENV_TO_KEY = {
  TEABLE_USERS_TABLE_ID: "users",
  TEABLE_LANGUAGE_PROFILES_TABLE_ID: "languageProfiles",
  TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID: "aiProviderSettings",
  TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID: "voiceProviderSettings",
  TEABLE_CONVERSATIONS_TABLE_ID: "conversations",
  TEABLE_MESSAGES_TABLE_ID: "messages",
  TEABLE_CORRECTIONS_TABLE_ID: "corrections",
  TEABLE_WORDS_TABLE_ID: "words",
  TEABLE_WORD_SENSES_TABLE_ID: "wordSenses",
  TEABLE_WORD_OCCURRENCES_TABLE_ID: "wordOccurrences",
  TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID: "wordUsageSummaries",
  TEABLE_DAILY_FEEDBACKS_TABLE_ID: "dailyFeedbacks",
  TEABLE_TOPICS_TABLE_ID: "topics",
  TEABLE_PRACTICE_SESSIONS_TABLE_ID: "practiceSessions",
  TEABLE_FLASHCARDS_TABLE_ID: "flashcards",
  TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID: "flashcardAttempts",
  TEABLE_APP_EVENTS_TABLE_ID: "appEvents"
};

function metaFor(envNameOrKey) {
  const key = ENV_TO_KEY[envNameOrKey] ?? envNameOrKey;
  const meta = tablesJson.tables.find((table) => table.key === key);
  if (!meta) throw new Error(`Unknown table: ${envNameOrKey}`);
  return meta;
}

export function getSupabaseAdmin(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function dbList(env, envNameOrKey, { limit = 1000 } = {}) {
  const meta = metaFor(envNameOrKey);
  const { data, error } = await getSupabaseAdmin(env).from(meta.tableName).select("*").limit(limit);
  if (error) throw new Error(`dbList ${meta.tableName}: ${error.message}`);
  return data.map((row) => ({ id: row.id, fields: Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "legacy_id")) }));
}

export async function dbInsert(env, envNameOrKey, fields) {
  const meta = metaFor(envNameOrKey);
  const { data, error } = await getSupabaseAdmin(env).from(meta.tableName).insert(fields).select("*").single();
  if (error) throw new Error(`dbInsert ${meta.tableName}: ${error.message}`);
  return { id: data.id, fields: Object.fromEntries(Object.entries(data).filter(([k]) => k !== "id" && k !== "legacy_id")) };
}

export async function dbDelete(env, envNameOrKey, id) {
  const meta = metaFor(envNameOrKey);
  const { error } = await getSupabaseAdmin(env).from(meta.tableName).delete().eq("id", id);
  if (error) throw new Error(`dbDelete ${meta.tableName}: ${error.message}`);
}
