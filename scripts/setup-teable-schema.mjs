import fs from "node:fs";

const envFlagIndex = process.argv.indexOf("--env");
const ENV_PATH = envFlagIndex >= 0 ? process.argv[envFlagIndex + 1] : ".env.local";

if (envFlagIndex >= 0 && !ENV_PATH) {
  throw new Error("--env requires a path.");
}

function readEnv(path) {
  const text = fs.readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return { text, env };
}

function writeEnv(path, original, updates) {
  let text = original;
  for (const [key, value] of Object.entries(updates)) {
    if (new RegExp(`^${key}=`, "m").test(text)) {
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    } else {
      text += `${text.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
    }
  }
  fs.writeFileSync(path, text);
}

function requireEnv(env, key, aliases = []) {
  for (const candidate of [key, ...aliases]) {
    if (env[candidate] && !env[candidate].includes("replace-with")) return env[candidate];
  }
  throw new Error(`${key} is required in ${ENV_PATH}.`);
}

const FIELD_TYPE_MAP = {
  text: "singleLineText",
  longText: "longText",
  number: "number",
  date: "date",
  checkbox: "checkbox",
  singleSelect: "singleSelect",
  url: "singleLineText",
  relation: "singleLineText",
  json: "longText"
};

const SELECT_CHOICES = {
  level: ["Iniciante", "Intermediário (B1)", "Avançado"],
  correction_style: ["Corrigir sempre", "Corrigir no final", "Só quando eu pedir"],
  provider: ["openai", "anthropic", "google", "openrouter", "custom", "kokoro"],
  output_format: ["mp3", "wav", "opus"],
  last_test_status: ["not_tested", "success", "error"],
  mode: ["free_conversation", "suggested_topic", "custom_topic", "review_words", "calendar_focus"],
  status: ["preparing", "active", "completed", "abandoned", "failed", "paused", "error"],
  role: ["user", "assistant", "system"],
  error_type: ["grammar", "vocabulary", "pronunciation", "tense", "preposition", "word_order", "naturalness", "spelling"],
  severity: ["low", "medium", "high"],
  source: ["user_custom", "ai_suggestion", "calendar_based", "weak_words", "recurring_error"],
  difficulty: ["A1", "A2", "B1", "B2", "C1", "C2"],
  type: ["conversation", "flashcards", "weak_words", "calendar_focus", "recurring_error"],
  card_type: ["target_to_native", "native_to_target", "cloze", "listening"],
  generation_source: ["ai", "deterministic", "fallback"],
  match_result: ["exact", "acceptable", "minor_error", "incorrect", "unknown"],
  suggested_rating: ["forgot", "hard", "good", "easy"],
  final_rating: ["forgot", "hard", "good", "easy"],
  last_rating: ["forgot", "hard", "good", "easy"],
  review_state: ["new", "learning", "review", "difficult", "suspended"]
};

const TABLES = [
  {
    envName: "TEABLE_USERS_TABLE_ID",
    name: "Users",
    fields: [
      ["avatar_url", "url"],
      ["active_language_id", "text"],
      ["timezone", "text"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
    name: "LanguageProfiles",
    fields: [
      ["user_id", "text"],
      ["language_code", "text"],
      ["language_name", "text"],
      ["level", "singleSelect"],
      ["learning_goal", "longText"],
      ["correction_style", "singleSelect"],
      ["audio_enabled", "checkbox"],
      ["transcript_enabled", "checkbox"],
      ["calendar_memory_enabled", "checkbox"],
      ["weekly_conversation_goal", "number"],
      ["weekly_word_goal", "number"],
      ["created_at", "date"],
      ["updated_at", "date"]
    ]
  },
  {
    envName: "TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID",
    name: "AIProviderSettings",
    fields: [
      ["user_id", "text"],
      ["provider", "singleSelect"],
      ["base_url", "url"],
      ["api_key_masked", "text"],
      ["chat_model", "text"],
      ["reasoning_model", "text"],
      ["temperature", "number"],
      ["max_tokens", "number"],
      ["is_active", "checkbox"],
      ["last_test_status", "singleSelect"],
      ["last_test_at", "date"]
    ]
  },
  {
    envName: "TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID",
    name: "VoiceProviderSettings",
    fields: [
      ["user_id", "text"],
      ["provider", "singleSelect"],
      ["base_url", "url"],
      ["api_key_masked", "text"],
      ["default_voice", "text"],
      ["speech_speed", "number"],
      ["output_format", "singleSelect"],
      ["is_active", "checkbox"],
      ["last_test_status", "singleSelect"],
      ["last_test_at", "date"]
    ]
  },
  {
    envName: "TEABLE_CONVERSATIONS_TABLE_ID",
    name: "Conversations",
    fields: [
      ["user_id", "text"],
      ["language_profile_id", "text"],
      ["topic_id", "text"],
      ["mode", "singleSelect"],
      ["status", "singleSelect"],
      ["started_at", "date"],
      ["ended_at", "date"],
      ["duration_seconds", "number"],
      ["ai_model_used", "text"],
      ["summary", "longText"]
    ]
  },
  {
    envName: "TEABLE_MESSAGES_TABLE_ID",
    name: "Messages",
    fields: [
      ["conversation_id", "text"],
      ["role", "singleSelect"],
      ["text", "longText"],
      ["audio_url", "url"],
      ["transcript_text", "longText"],
      ["language_detected", "text"],
      ["tokens_used", "number"],
      ["client_request_id", "text"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_CORRECTIONS_TABLE_ID",
    name: "Corrections",
    fields: [
      ["conversation_id", "text"],
      ["message_id", "text"],
      ["original_text", "longText"],
      ["corrected_text", "longText"],
      ["error_type", "singleSelect"],
      ["explanation", "longText"],
      ["severity", "singleSelect"],
      ["should_interrupt", "checkbox"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_WORDS_TABLE_ID",
    name: "Words",
    fields: [
      ["user_id", "text"],
      ["language_profile_id", "text"],
      ["lemma", "text"],
      ["canonical_key", "text"],
      ["display_text", "text"],
      ["forms_json", "longText"],
      ["translation", "text"],
      ["part_of_speech", "text"],
      ["familiarity_score", "number"],
      ["total_uses", "number"],
      ["last_used_at", "date"],
      ["first_used_at", "date"],
      ["review_due_at", "date"],
      ["review_interval_days", "number"],
      ["review_ease", "number"],
      ["review_streak", "number"],
      ["lapse_count", "number"],
      ["last_reviewed_at", "date"],
      ["last_rating", "singleSelect"],
      ["average_response_time_ms", "number"],
      ["review_state", "singleSelect"],
      ["review_version", "text"]
    ]
  },
  {
    envName: "TEABLE_WORD_OCCURRENCES_TABLE_ID",
    name: "WordOccurrences",
    fields: [
      ["word_id", "text"],
      ["occurrence_key", "text"],
      ["conversation_id", "text"],
      ["message_id", "text"],
      ["used_text", "text"],
      ["sentence_context", "longText"],
      ["was_correct", "checkbox"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID",
    name: "WordUsageSummaries",
    fields: [
      ["usage_key", "text"],
      ["word_id", "text"],
      ["conversation_id", "text"],
      ["forms_json", "longText"],
      ["observed_count", "number"],
      ["correct_use_count", "number"],
      ["correction_count", "number"],
      ["first_used_at", "date"],
      ["last_used_at", "date"]
    ]
  },
  {
    envName: "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
    name: "DailyFeedbacks",
    fields: [
      ["user_id", "text"],
      ["language_profile_id", "text"],
      ["date", "date"],
      ["strengths", "longText"],
      ["weaknesses", "longText"],
      ["recommended_focus", "longText"],
      ["recurring_errors", "longText"],
      ["new_words_count", "number"],
      ["correction_score", "number"],
      ["fluency_score", "number"],
      ["suggested_topics", "longText"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_TOPICS_TABLE_ID",
    name: "Topics",
    fields: [
      ["user_id", "text"],
      ["language_profile_id", "text"],
      ["title", "text"],
      ["source", "singleSelect"],
      ["reason", "longText"],
      ["related_feedback_id", "text"],
      ["related_words", "longText"],
      ["difficulty", "singleSelect"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
    name: "PracticeSessions",
    fields: [
      ["user_id", "text"],
      ["language_profile_id", "text"],
      ["conversation_id", "text"],
      ["type", "singleSelect"],
      ["focus", "text"],
      ["status", "singleSelect"],
      ["started_at", "date"],
      ["ended_at", "date"],
      ["duration_seconds", "number"],
      ["criterion", "text"],
      ["requested_word_count", "number"],
      ["selected_word_count", "number"],
      ["unique_card_count", "number"],
      ["presentation_count", "number"],
      ["correct_count", "number"],
      ["incorrect_count", "number"],
      ["score", "number"],
      ["language_code", "text"],
      ["configuration_json", "longText"],
      ["parent_session_id", "text"],
      ["created_at", "date"],
      ["updated_at", "date"]
    ]
  },
  {
    envName: "TEABLE_FLASHCARDS_TABLE_ID",
    name: "Flashcards",
    fields: [
      ["practice_session_id", "text"],
      ["target_word_id", "text"],
      ["supporting_word_ids", "longText"],
      ["card_type", "singleSelect"],
      ["prompt", "longText"],
      ["expected_answer", "longText"],
      ["accepted_answers", "longText"],
      ["translation", "longText"],
      ["explanation", "longText"],
      ["sentence", "longText"],
      ["audio_text", "longText"],
      ["difficulty", "number"],
      ["initial_position", "number"],
      ["generation_source", "singleSelect"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
    name: "FlashcardAttempts",
    fields: [
      ["practice_session_id", "text"],
      ["flashcard_id", "text"],
      ["word_id", "text"],
      ["presentation_number", "number"],
      ["client_attempt_id", "text"],
      ["user_answer", "longText"],
      ["normalized_answer", "longText"],
      ["match_result", "singleSelect"],
      ["suggested_rating", "singleSelect"],
      ["final_rating", "singleSelect"],
      ["was_correct", "checkbox"],
      ["response_time_ms", "number"],
      ["used_speech", "checkbox"],
      ["audio_replay_count", "number"],
      ["used_slow_audio", "checkbox"],
      ["answered_after_audio_replay", "checkbox"],
      ["audio_failed", "checkbox"],
      ["created_at", "date"]
    ]
  },
  {
    envName: "TEABLE_APP_EVENTS_TABLE_ID",
    name: "AppEvents",
    fields: [
      ["user_id", "text"],
      ["event_name", "text"],
      ["payload", "longText"],
      ["created_at", "date"]
    ]
  }
];

function fieldPayload(name, logicalType) {
  const type = FIELD_TYPE_MAP[logicalType] ?? "singleLineText";
  const payload = { name, type };
  if (type === "singleSelect") {
    const choices = SELECT_CHOICES[name] ?? ["light", "medium", "heavy"];
    payload.options = {
      choices: choices.map((choice, index) => ({
        name: choice,
        color: ["grayBright", "greenBright", "yellowBright", "blueBright", "purpleBright", "redBright"][index % 6]
      }))
    };
  }
  return payload;
}

function singleSelectConversionPayload(existingField, expectedChoices) {
  const currentChoices = existingField.options?.choices ?? [];
  const currentNames = new Set(currentChoices.map((choice) => choice.name));
  const colors = ["grayBright", "greenBright", "yellowBright", "blueBright", "purpleBright", "redBright"];
  const choices = [
    ...currentChoices,
    ...expectedChoices
      .filter((choice) => !currentNames.has(choice))
      .map((choice, index) => ({
        name: choice,
        color: colors[(currentChoices.length + index) % colors.length]
      }))
  ];

  return {
    type: "singleSelect",
    name: existingField.name,
    options: {
      ...(existingField.options ?? {}),
      choices
    }
  };
}

async function teableRequest(baseUrl, token, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { text, env } = readEnv(ENV_PATH);
  const baseUrl = requireEnv(env, "TEABLE_BASE_URL").replace(/\/+$/, "");
  const token = requireEnv(env, "TEABLE_API_KEY", ["TEABLE_TOKEN"]);
  const baseId = requireEnv(env, "TEABLE_BASE_ID");

  console.log(apply ? "Applying Teable schema..." : "Dry run only. Use --apply to create/update Teable schema.");
  console.log(`Base id: ${baseId}`);

  const existingTables = await teableRequest(baseUrl, token, `/api/base/${baseId}/table`);
  const byName = new Map(existingTables.map((table) => [table.name, table]));
  const envUpdates = {};

  for (const tableDef of TABLES) {
    let table = byName.get(tableDef.name);

    if (!table) {
      console.log(`+ table ${tableDef.name}`);
      if (apply) {
        table = await teableRequest(baseUrl, token, `/api/base/${baseId}/table`, {
          method: "POST",
          body: JSON.stringify({ name: tableDef.name })
        });
      } else {
        continue;
      }
    } else {
      console.log(`= table ${tableDef.name}`);
    }

    envUpdates[tableDef.envName] = table.id;

    const fields = await teableRequest(baseUrl, token, `/api/table/${table.id}/field`);
    const existingFields = new Map(fields.map((field) => [field.name, field]));

    for (const [name, logicalType] of tableDef.fields) {
      const existingField = existingFields.get(name);
      if (existingField) {
        console.log(`  = field ${tableDef.name}.${name}`);
        const expectedChoices = logicalType === "singleSelect" ? SELECT_CHOICES[name] : undefined;
        const currentChoices = existingField.options?.choices?.map((choice) => choice.name) ?? [];
        const missingChoices = expectedChoices?.filter((choice) => !currentChoices.includes(choice)) ?? [];
        if (missingChoices.length) {
          console.log(`  ~ choices ${tableDef.name}.${name}: ${missingChoices.join(", ")}`);
          if (apply) {
            await teableRequest(baseUrl, token, `/api/table/${table.id}/field/${existingField.id}/convert`, {
              method: "PUT",
              body: JSON.stringify(singleSelectConversionPayload(existingField, expectedChoices))
            });

            const updatedField = await teableRequest(baseUrl, token, `/api/table/${table.id}/field/${existingField.id}`);
            const updatedChoices = new Set(updatedField.options?.choices?.map((choice) => choice.name) ?? []);
            const stillMissing = expectedChoices.filter((choice) => !updatedChoices.has(choice));
            if (stillMissing.length) {
              throw new Error(`Could not add choices to ${tableDef.name}.${name}: ${stillMissing.join(", ")}`);
            }
          }
        }
        continue;
      }

      console.log(`  + field ${tableDef.name}.${name} (${logicalType})`);
      if (apply) {
        await teableRequest(baseUrl, token, `/api/table/${table.id}/field`, {
          method: "POST",
          body: JSON.stringify(fieldPayload(name, logicalType))
        });
      }
    }
  }

  if (apply) {
    writeEnv(ENV_PATH, text, envUpdates);
    console.log(`Updated ${ENV_PATH} with ${Object.keys(envUpdates).length} table ids.`);
  }
}

main().catch((error) => {
  const { env } = fs.existsSync(ENV_PATH) ? readEnv(ENV_PATH) : { env: {} };
  const baseId = env.TEABLE_BASE_ID ?? "";
  console.error(String(error.message ?? error).replace(baseId, "[base-id]"));
  process.exit(1);
});
