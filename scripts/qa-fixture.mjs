import fs from "node:fs";
import path from "node:path";
import { assertQaEnvironment, readEnv } from "./qa-env.mjs";
import { dbInsert, getSupabaseAdmin } from "./lib/supabase-admin.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");
const env = readEnv(envPath);
assertQaEnvironment(env);

const runId = `qa-${Date.now()}`;
const created = {};
const fixtureDir = ".qa-fixtures";
const manifestPath = path.join(fixtureDir, `${runId}.json`);
const now = new Date().toISOString();

function saveManifest() {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ runId, namespace: env.QA_RUN_NAMESPACE, createdAt: now, records: created }, null, 2),
    { mode: 0o600 }
  );
}

saveManifest();

async function create(tableEnvName, fields) {
  const record = await dbInsert(env, tableEnvName, fields);
  if (!record?.id) throw new Error(`QA fixture record was not returned for ${tableEnvName}.`);
  (created[tableEnvName] ??= []).push(record.id);
  saveManifest();
  return record;
}

const past = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
const user = await create("TEABLE_USERS_TABLE_ID", {
  Name: `QA User ${runId}`,
  avatar_url: "",
  active_language_id: null,
  timezone: "America/Sao_Paulo",
  created_at: now
});
const profile = await create("TEABLE_LANGUAGE_PROFILES_TABLE_ID", {
  user_id: user.id,
  language_code: "en",
  language_name: "Inglês",
  level: "Intermediário (B1)",
  learning_goal: "QA conversation validation",
  correction_style: "Corrigir sempre",
  audio_enabled: true,
  transcript_enabled: true,
  calendar_memory_enabled: true,
  weekly_conversation_goal: 3,
  weekly_word_goal: 20,
  created_at: now,
  updated_at: now
});
const usersTable = tablesJson.tables.find((table) => table.key === "users").tableName;
const { error: linkError } = await getSupabaseAdmin(env)
  .from(usersTable)
  .update({ active_language_id: profile.id })
  .eq("id", user.id);
if (linkError) throw new Error(`update ${usersTable}.active_language_id: ${linkError.message}`);
const topic = await create("TEABLE_TOPICS_TABLE_ID", {
  Name: `QA Topic ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  title: `QA Topic ${runId}`,
  source: "user_custom",
  reason: "Fixture used only for automated QA.",
  related_feedback_id: null,
  related_words: "",
  difficulty: "B1",
  created_at: now
});
const activeConversation = await create("TEABLE_CONVERSATIONS_TABLE_ID", {
  Name: `QA Active ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  topic_id: topic.id,
  mode: "free_conversation",
  interaction_mode: "simulation",
  target_user_message_count: 2,
  status: "active",
  started_at: now,
  ended_at: null,
  duration_seconds: 0,
  ai_model_used: "qa-fixture",
  summary: ""
});
await create("TEABLE_MESSAGES_TABLE_ID", {
  Name: `QA Active assistant ${runId}`,
  conversation_id: activeConversation.id,
  role: "assistant",
  text: "Let's practice with a short answer.",
  audio_url: "",
  transcript_text: "Let's practice with a short answer.",
  language_detected: "en",
  tokens_used: 0,
  channel: "practice",
  created_at: now
});
const completedConversation = await create("TEABLE_CONVERSATIONS_TABLE_ID", {
  Name: `QA Completed ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  topic_id: topic.id,
  mode: "free_conversation",
  interaction_mode: "conversation",
  target_user_message_count: 0,
  status: "completed",
  started_at: past,
  ended_at: past,
  duration_seconds: 120,
  ai_model_used: "qa-fixture",
  summary: "Completed QA fixture."
});
const word = await create("TEABLE_WORDS_TABLE_ID", {
  Name: `QA Word ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  lemma: "fixture",
  display_text: "fixture",
  translation: "teste",
  part_of_speech: "noun",
  familiarity_score: 1,
  total_uses: 1,
  last_used_at: past,
  first_used_at: past,
  review_due_at: past
});
await create("TEABLE_WORDS_TABLE_ID", {
  Name: `QA Word two ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  lemma: "practice",
  display_text: "practice",
  translation: "prática",
  part_of_speech: "noun",
  familiarity_score: 2,
  total_uses: 2,
  last_used_at: past,
  first_used_at: past,
  review_due_at: past
});
const message = await create("TEABLE_MESSAGES_TABLE_ID", {
  Name: `QA Message ${runId}`,
  conversation_id: completedConversation.id,
  role: "user",
  text: "Yesterday I have coffee.",
  audio_url: "",
  transcript_text: "Yesterday I have coffee.",
  language_detected: "en",
  tokens_used: 0,
  channel: "practice",
  created_at: past
});
await create("TEABLE_CORRECTIONS_TABLE_ID", {
  Name: `QA Correction ${runId}`,
  conversation_id: completedConversation.id,
  message_id: message.id,
  original_text: "Yesterday I have coffee.",
  corrected_text: "Yesterday I had coffee.",
  explanation: "Use the past simple for a completed action yesterday.",
  error_type: "grammar",
  severity: "medium",
  should_interrupt: true,
  created_at: past
});
await create("TEABLE_WORD_OCCURRENCES_TABLE_ID", {
  Name: `QA Word occurrence ${runId}`,
  word_id: word.id,
  conversation_id: completedConversation.id,
  message_id: message.id,
  used_text: "fixture",
  sentence_context: "Yesterday I have coffee.",
  was_correct: false,
  created_at: past
});
await create("TEABLE_DAILY_FEEDBACKS_TABLE_ID", {
  Name: past.slice(0, 10),
  user_id: user.id,
  language_profile_id: profile.id,
  date: past.slice(0, 10),
  strengths: "QA fixture strength",
  weaknesses: "QA fixture weakness",
  recommended_focus: "QA fixture focus",
  recurring_errors: ["tense"],
  new_words_count: 1,
  correction_score: 8,
  fluency_score: 7,
  suggested_topics: [],
  created_at: now
});
await create("TEABLE_PRACTICE_SESSIONS_TABLE_ID", {
  Name: `QA Session ${runId}`,
  user_id: user.id,
  language_profile_id: profile.id,
  conversation_id: activeConversation.id,
  type: "conversation",
  focus: "QA fixture",
  configuration_json: { interactionMode: "simulation", targetUserMessageCount: 2 },
  created_at: now
});
await create("TEABLE_APP_EVENTS_TABLE_ID", {
  Name: `QA Fixture ${runId}`,
  user_id: user.id,
  event_name: "qa_fixture_created",
  payload: { runId, namespace: env.QA_RUN_NAMESPACE },
  created_at: now
});

console.log(`QA fixture created: ${runId}. Manifest: ${manifestPath}`);
