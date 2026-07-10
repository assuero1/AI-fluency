export type TeableTableKey =
  | "users"
  | "languageProfiles"
  | "aiProviderSettings"
  | "voiceProviderSettings"
  | "conversations"
  | "messages"
  | "corrections"
  | "words"
  | "wordOccurrences"
  | "dailyFeedbacks"
  | "topics"
  | "practiceSessions"
  | "appEvents";

export type TeableFieldType =
  | "text"
  | "longText"
  | "number"
  | "date"
  | "checkbox"
  | "singleSelect"
  | "url"
  | "relation"
  | "json";

export type TeableFieldDefinition = {
  name: string;
  type: TeableFieldType;
  required?: boolean;
  note?: string;
};

export type TeableTableDefinition = {
  key: TeableTableKey;
  envName: string;
  displayName: string;
  purpose: string;
  fields: TeableFieldDefinition[];
};

export const teableSchema: TeableTableDefinition[] = [
  {
    key: "users",
    envName: "TEABLE_USERS_TABLE_ID",
    displayName: "Users",
    purpose: "Stores the user profile.",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "avatar_url", type: "url" },
      { name: "active_language_id", type: "relation", note: "LanguageProfiles" },
      { name: "timezone", type: "text" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "languageProfiles",
    envName: "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
    displayName: "LanguageProfiles",
    purpose: "One learning profile per language.",
    fields: [
      { name: "user_id", type: "relation", required: true, note: "Users" },
      { name: "language_code", type: "text", required: true },
      { name: "language_name", type: "text", required: true },
      { name: "level", type: "singleSelect", required: true },
      { name: "learning_goal", type: "longText" },
      { name: "correction_style", type: "singleSelect" },
      { name: "audio_enabled", type: "checkbox" },
      { name: "transcript_enabled", type: "checkbox" },
      { name: "calendar_memory_enabled", type: "checkbox" },
      { name: "weekly_conversation_goal", type: "number" },
      { name: "weekly_word_goal", type: "number" },
      { name: "created_at", type: "date" },
      { name: "updated_at", type: "date" }
    ]
  },
  {
    key: "aiProviderSettings",
    envName: "TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID",
    displayName: "AIProviderSettings",
    purpose: "Stores AI provider/model status. Actual secrets stay server-side.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "provider", type: "singleSelect" },
      { name: "base_url", type: "url" },
      { name: "api_key_masked", type: "text" },
      { name: "chat_model", type: "text" },
      { name: "reasoning_model", type: "text" },
      { name: "temperature", type: "number" },
      { name: "max_tokens", type: "number" },
      { name: "is_active", type: "checkbox" },
      { name: "last_test_status", type: "singleSelect" },
      { name: "last_test_at", type: "date" }
    ]
  },
  {
    key: "voiceProviderSettings",
    envName: "TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID",
    displayName: "VoiceProviderSettings",
    purpose: "Stores Kokoro configuration/status. Actual secrets stay server-side.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "provider", type: "singleSelect" },
      { name: "base_url", type: "url" },
      { name: "api_key_masked", type: "text" },
      { name: "default_voice", type: "text" },
      { name: "speech_speed", type: "number" },
      { name: "output_format", type: "singleSelect" },
      { name: "is_active", type: "checkbox" },
      { name: "last_test_status", type: "singleSelect" },
      { name: "last_test_at", type: "date" }
    ]
  },
  {
    key: "conversations",
    envName: "TEABLE_CONVERSATIONS_TABLE_ID",
    displayName: "Conversations",
    purpose: "One study session.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "language_profile_id", type: "relation", note: "LanguageProfiles" },
      { name: "topic_id", type: "relation", note: "Topics" },
      { name: "mode", type: "singleSelect" },
      { name: "status", type: "singleSelect" },
      { name: "started_at", type: "date" },
      { name: "ended_at", type: "date" },
      { name: "duration_seconds", type: "number" },
      { name: "ai_model_used", type: "text" },
      { name: "summary", type: "longText" }
    ]
  },
  {
    key: "messages",
    envName: "TEABLE_MESSAGES_TABLE_ID",
    displayName: "Messages",
    purpose: "Every user or assistant message.",
    fields: [
      { name: "conversation_id", type: "relation", note: "Conversations" },
      { name: "role", type: "singleSelect" },
      { name: "text", type: "longText" },
      { name: "audio_url", type: "url" },
      { name: "transcript_text", type: "longText" },
      { name: "language_detected", type: "text" },
      { name: "tokens_used", type: "number" },
      { name: "client_request_id", type: "text" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "corrections",
    envName: "TEABLE_CORRECTIONS_TABLE_ID",
    displayName: "Corrections",
    purpose: "Language corrections generated by AI.",
    fields: [
      { name: "conversation_id", type: "relation", note: "Conversations" },
      { name: "message_id", type: "relation", note: "Messages" },
      { name: "original_text", type: "longText" },
      { name: "corrected_text", type: "longText" },
      { name: "error_type", type: "singleSelect" },
      { name: "explanation", type: "longText" },
      { name: "severity", type: "singleSelect" },
      { name: "should_interrupt", type: "checkbox" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "words",
    envName: "TEABLE_WORDS_TABLE_ID",
    displayName: "Words",
    purpose: "Consolidated user vocabulary.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "language_profile_id", type: "relation", note: "LanguageProfiles" },
      { name: "lemma", type: "text" },
      { name: "display_text", type: "text" },
      { name: "translation", type: "text" },
      { name: "part_of_speech", type: "text" },
      { name: "familiarity_score", type: "number" },
      { name: "total_uses", type: "number" },
      { name: "last_used_at", type: "date" },
      { name: "first_used_at", type: "date" },
      { name: "review_due_at", type: "date" }
    ]
  },
  {
    key: "wordOccurrences",
    envName: "TEABLE_WORD_OCCURRENCES_TABLE_ID",
    displayName: "WordOccurrences",
    purpose: "Every contextual use of a word.",
    fields: [
      { name: "word_id", type: "relation", note: "Words" },
      { name: "conversation_id", type: "relation", note: "Conversations" },
      { name: "message_id", type: "relation", note: "Messages" },
      { name: "used_text", type: "text" },
      { name: "sentence_context", type: "longText" },
      { name: "was_correct", type: "checkbox" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "dailyFeedbacks",
    envName: "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
    displayName: "DailyFeedbacks",
    purpose: "Daily learning memory.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "language_profile_id", type: "relation", note: "LanguageProfiles" },
      { name: "date", type: "date" },
      { name: "strengths", type: "longText" },
      { name: "weaknesses", type: "longText" },
      { name: "recommended_focus", type: "longText" },
      { name: "recurring_errors", type: "json" },
      { name: "new_words_count", type: "number" },
      { name: "correction_score", type: "number" },
      { name: "fluency_score", type: "number" },
      { name: "suggested_topics", type: "json" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "topics",
    envName: "TEABLE_TOPICS_TABLE_ID",
    displayName: "Topics",
    purpose: "User-created or AI-generated conversation themes.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "language_profile_id", type: "relation", note: "LanguageProfiles" },
      { name: "title", type: "text" },
      { name: "source", type: "singleSelect" },
      { name: "reason", type: "longText" },
      { name: "related_feedback_id", type: "relation", note: "DailyFeedbacks" },
      { name: "related_words", type: "relation", note: "Words" },
      { name: "difficulty", type: "singleSelect" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "practiceSessions",
    envName: "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
    displayName: "PracticeSessions",
    purpose: "Grouped practice actions.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "language_profile_id", type: "relation", note: "LanguageProfiles" },
      { name: "conversation_id", type: "relation", note: "Conversations" },
      { name: "type", type: "singleSelect" },
      { name: "focus", type: "text" },
      { name: "created_at", type: "date" }
    ]
  },
  {
    key: "appEvents",
    envName: "TEABLE_APP_EVENTS_TABLE_ID",
    displayName: "AppEvents",
    purpose: "Product/debug event trail.",
    fields: [
      { name: "user_id", type: "relation", note: "Users" },
      { name: "event_name", type: "text", required: true },
      { name: "payload", type: "json" },
      { name: "created_at", type: "date" }
    ]
  }
];

export function getSchemaTable(key: TeableTableKey) {
  return teableSchema.find((table) => table.key === key);
}
