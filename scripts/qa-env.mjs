import fs from "node:fs";

export const tableDefinitions = [
  ["TEABLE_USERS_TABLE_ID", "Users"],
  ["TEABLE_LANGUAGE_PROFILES_TABLE_ID", "LanguageProfiles"],
  ["TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID", "AIProviderSettings"],
  ["TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID", "VoiceProviderSettings"],
  ["TEABLE_CONVERSATIONS_TABLE_ID", "Conversations"],
  ["TEABLE_MESSAGES_TABLE_ID", "Messages"],
  ["TEABLE_CORRECTIONS_TABLE_ID", "Corrections"],
  ["TEABLE_WORDS_TABLE_ID", "Words"],
  ["TEABLE_WORD_OCCURRENCES_TABLE_ID", "WordOccurrences"],
  ["TEABLE_DAILY_FEEDBACKS_TABLE_ID", "DailyFeedbacks"],
  ["TEABLE_TOPICS_TABLE_ID", "Topics"],
  ["TEABLE_PRACTICE_SESSIONS_TABLE_ID", "PracticeSessions"],
  ["TEABLE_FLASHCARDS_TABLE_ID", "Flashcards"],
  ["TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID", "FlashcardAttempts"],
  ["TEABLE_APP_EVENTS_TABLE_ID", "AppEvents"]
];

export function readEnv(path) {
  if (!fs.existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

export function required(env, name, aliases = []) {
  for (const candidate of [name, ...aliases]) {
    const value = env[candidate]?.trim();
    if (value && !value.startsWith("replace-with") && !value.includes("your-")) return value;
  }
  throw new Error(`${name} is required.`);
}

export function assertQaEnvironment(env) {
  if (env.APP_ENV !== "qa") throw new Error("QA scripts require APP_ENV=qa.");
  if (env.QA_RUN_NAMESPACE !== "AI_FLUENCY_QA") {
    throw new Error("QA scripts require QA_RUN_NAMESPACE=AI_FLUENCY_QA.");
  }
}

export async function teableRequest(env, path, init = {}) {
  const baseUrl = required(env, "TEABLE_BASE_URL").replace(/\/+$/, "");
  const token = required(env, "TEABLE_API_KEY", ["TEABLE_TOKEN"]);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${init.method ?? "GET"} ${path} failed with ${response.status}: ${detail.slice(0, 500)}`);
  }
  return body;
}

export function recordsFrom(result) {
  return result?.records ?? result?.data?.records ?? [];
}
