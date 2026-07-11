import { randomUUID } from "node:crypto";
import { getConnectionStatus } from "@/lib/settings/status";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import type { TeableTableKey } from "@/lib/teable/schema";
import type { ConversationFields, CorrectionFields, MessageFields, WordFields, WordOccurrenceFields } from "./conversations";
import type { DailyFeedbackFields, TopicFields } from "./home";
import type { FlashcardAttemptFields, FlashcardFields } from "./flashcards";
import { getActiveLanguageProfile, getOrCreatePersonalUser, LanguageProfileFields, UserFields } from "./profile";
import { matchesLearningScope } from "./scope";
import { PERSONAL_DATA_EXPORT_SCHEMA_VERSION } from "./export";

const DELETE_PHRASE = "LIMPAR HISTORICO";
const DELETE_EVENT = "learning_history_delete_challenge";
const DELETE_SCOPE = "learning_history";

export class AccountValidationError extends Error {
  status = 400;
}

type PreferenceInput = {
  correctionStyle?: string;
  audioEnabled?: boolean;
  transcriptEnabled?: boolean;
  calendarMemoryEnabled?: boolean;
  weeklyConversationGoal?: number;
  weeklyWordGoal?: number;
};

type ProfileInput = {
  name?: string;
  timezone?: string;
  activeLanguageId?: string;
};

export type LearningHistoryEventFields = {
  user_id?: string;
  event_name?: string;
  payload?: string;
};

export type LearningHistoryEventScope = {
  profileId: string;
  conversationIds: Set<string>;
  topicIds: Set<string>;
  wordIds: Set<string>;
  feedbackIds: Set<string>;
};

export async function getProfileSettings() {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const [profiles, activeProfile] = await Promise.all([
    client.listRecords<LanguageProfileFields>("languageProfiles", 50),
    getActiveLanguageProfile(user)
  ]);
  const ownProfiles = profiles.filter((profile) => profile.fields.user_id === user.id);

  return {
    user: {
      id: user.id,
      name: user.fields.Name ?? user.fields.name ?? "Camila",
      timezone: user.fields.timezone ?? "America/Sao_Paulo",
      activeLanguageId: activeProfile?.id ?? ""
    },
    activeProfile: activeProfile
      ? {
          id: activeProfile.id,
          languageCode: activeProfile.fields.language_code,
          languageName: activeProfile.fields.language_name,
          level: activeProfile.fields.level,
          learningGoal: activeProfile.fields.learning_goal,
          correctionStyle: activeProfile.fields.correction_style,
          audioEnabled: Boolean(activeProfile.fields.audio_enabled),
          transcriptEnabled: Boolean(activeProfile.fields.transcript_enabled),
          calendarMemoryEnabled: Boolean(activeProfile.fields.calendar_memory_enabled),
          weeklyConversationGoal: Number(activeProfile.fields.weekly_conversation_goal ?? 7),
          weeklyWordGoal: Number(activeProfile.fields.weekly_word_goal ?? 500)
        }
      : null,
    languageProfiles: ownProfiles.map((profile) => ({
      id: profile.id,
      languageCode: profile.fields.language_code,
      languageName: profile.fields.language_name,
      level: profile.fields.level
    })),
    connections: getConnectionStatus()
  };
}

export async function updatePersonalProfile(input: ProfileInput) {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profiles = await client.listRecords<LanguageProfileFields>("languageProfiles", 50);
  const fields: Partial<UserFields> = {};

  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) throw new AccountValidationError("Informe seu nome.");
    fields.Name = name.slice(0, 80);
  }
  if (typeof input.timezone === "string" && input.timezone.trim()) fields.timezone = input.timezone.trim().slice(0, 80);
  if (typeof input.activeLanguageId === "string" && input.activeLanguageId) {
    const profile = profiles.find((item) => item.id === input.activeLanguageId && item.fields.user_id === user.id);
    if (!profile) throw new AccountValidationError("O idioma selecionado não pertence a este perfil.");
    fields.active_language_id = profile.id;
  }
  if (!Object.keys(fields).length) throw new AccountValidationError("Nenhuma alteração de perfil foi informada.");

  const updated = await client.updateRecord<UserFields>("users", user.id, fields);
  await client.createEvent(user.id, "profile_updated", { fields: Object.keys(fields) });
  return updated;
}

export async function updatePreferences(input: PreferenceInput) {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new AccountValidationError("Crie um perfil de idioma antes de alterar preferências.");

  const fields: Partial<LanguageProfileFields> = { updated_at: new Date().toISOString() };
  if (typeof input.correctionStyle === "string") {
    const allowed = ["Corrigir sempre", "Corrigir no final", "Só quando eu pedir"];
    if (!allowed.includes(input.correctionStyle)) throw new AccountValidationError("Estilo de correção inválido.");
    fields.correction_style = input.correctionStyle;
  }
  if (typeof input.audioEnabled === "boolean") fields.audio_enabled = input.audioEnabled;
  if (typeof input.transcriptEnabled === "boolean") fields.transcript_enabled = input.transcriptEnabled;
  if (typeof input.calendarMemoryEnabled === "boolean") fields.calendar_memory_enabled = input.calendarMemoryEnabled;
  if (typeof input.weeklyConversationGoal === "number") fields.weekly_conversation_goal = clampGoal(input.weeklyConversationGoal, 1, 30);
  if (typeof input.weeklyWordGoal === "number") fields.weekly_word_goal = clampGoal(input.weeklyWordGoal, 10, 2000);

  const finalAudio = fields.audio_enabled ?? Boolean(profile.fields.audio_enabled);
  const finalTranscript = fields.transcript_enabled ?? Boolean(profile.fields.transcript_enabled);
  if (!finalAudio && !finalTranscript) throw new AccountValidationError("Mantenha áudio ou transcrição ativados para continuar estudando.");

  const updated = await client.updateRecord<LanguageProfileFields>("languageProfiles", profile.id, fields);
  await client.createEvent(user.id, "preferences_updated", { fields: Object.keys(fields).filter((key) => key !== "updated_at") });
  return updated;
}

export async function exportPersonalData() {
  const data = await getScopedLearningData();
  return {
    schemaVersion: PERSONAL_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    scope: "personal_learning_data",
    language: data.profile
      ? {
          id: data.profile.id,
          code: data.profile.fields.language_code,
          name: data.profile.fields.language_name
        }
      : null,
    user: data.user,
    activeLanguageProfile: data.profile,
    languageProfiles: data.profiles,
    learningHistory: {
      conversations: data.conversations,
      messages: data.messages,
      corrections: data.corrections,
      words: data.words,
      wordOccurrences: data.wordOccurrences,
      dailyFeedbacks: data.dailyFeedbacks,
      topics: data.topics,
      practiceSessions: data.practiceSessions,
      flashcards: data.flashcards,
      flashcardAttempts: data.flashcardAttempts
    }
  };
}

export async function createDeletionConfirmation() {
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new AccountValidationError("Crie um perfil de idioma antes de limpar o histórico.");
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await getTeableClient().createEvent(user.id, DELETE_EVENT, {
    token,
    scope: DELETE_SCOPE,
    language_profile_id: profile.id,
    expiresAt
  });
  return {
    confirmationToken: token,
    confirmationPhrase: DELETE_PHRASE,
    expiresAt: new Date(expiresAt).toISOString(),
    scope: DELETE_SCOPE
  };
}

export async function deleteLearningHistory(input: { confirmationToken?: string; phrase?: string }) {
  if (normalizePhrase(input.phrase) !== DELETE_PHRASE) throw new AccountValidationError("Digite a frase de confirmação exatamente como exibida.");
  if (!input.confirmationToken) throw new AccountValidationError("Crie uma confirmação antes de limpar o histórico.");

  const client = getTeableClient();
  const data = await getScopedLearningData();
  if (!data.profile) throw new AccountValidationError("Crie um perfil de idioma antes de limpar o histórico.");
  const events = await client.listRecords<LearningHistoryEventFields>("appEvents", 400);
  const challenge = events.find((event) => {
    if (event.fields.user_id !== data.user.id || event.fields.event_name !== DELETE_EVENT) return false;
    const payload = parsePayload(event.fields.payload);
    return payload.token === input.confirmationToken
      && payload.scope === DELETE_SCOPE
      && payload.language_profile_id === data.profile?.id
      && Number(payload.expiresAt) > Date.now();
  });
  if (!challenge) throw new AccountValidationError("A confirmação expirou ou é inválida. Solicite uma nova confirmação.");

  const eventScope: LearningHistoryEventScope = {
    profileId: data.profile.id,
    conversationIds: new Set(data.conversations.map((record) => record.id)),
    topicIds: new Set(data.topics.map((record) => record.id)),
    wordIds: new Set(data.words.map((record) => record.id)),
    feedbackIds: new Set(data.dailyFeedbacks.map((record) => record.id))
  };
  const scopedEvents = events.filter(
    (event) => event.id === challenge.id
      || (event.fields.user_id === data.user.id && isLearningHistoryEventInScope(event.fields, eventScope))
  );
  const groups: Array<[TeableTableKey, Array<{ id: string }>]> = [
    ["flashcardAttempts", data.flashcardAttempts],
    ["flashcards", data.flashcards],
    ["wordOccurrences", data.wordOccurrences],
    ["corrections", data.corrections],
    ["messages", data.messages],
    ["practiceSessions", data.practiceSessions],
    ["conversations", data.conversations],
    ["dailyFeedbacks", data.dailyFeedbacks],
    ["words", data.words],
    ["topics", data.topics],
    ["appEvents", scopedEvents]
  ];
  const deleted: Record<string, number> = {};
  for (const [table, records] of groups) {
    for (const record of records) await client.deleteRecord(table, record.id);
    deleted[table] = records.length;
  }

  await client.createEvent(data.user.id, "learning_history_deleted", {
    deleted,
    scope: DELETE_SCOPE,
    language_profile_id: data.profile.id
  });
  return {
    deleted,
    preserved: ["user_profile", "language_preferences", "other_language_profiles", "connection_settings"]
  };
}

export function isLearningHistoryEventInScope(fields: LearningHistoryEventFields, scope: LearningHistoryEventScope) {
  const payload = parsePayload(fields.payload);
  if (typeof payload.language_profile_id === "string") return payload.language_profile_id === scope.profileId;

  const scalarMatches = [
    [payload.conversation_id, scope.conversationIds],
    [payload.topic_id, scope.topicIds],
    [payload.word_id, scope.wordIds],
    [payload.daily_feedback_id, scope.feedbackIds]
  ] as const;
  if (scalarMatches.some(([value, ids]) => typeof value === "string" && ids.has(value))) return true;

  return Array.isArray(payload.word_ids)
    && payload.word_ids.some((value) => typeof value === "string" && scope.wordIds.has(value));
}

async function getScopedLearningData() {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  const [profiles, conversations, messages, corrections, words, wordOccurrences, dailyFeedbacks, topics, practiceSessions, flashcards, flashcardAttempts] = await Promise.all([
    client.listAllRecords<LanguageProfileFields>("languageProfiles"),
    client.listAllRecords<ConversationFields>("conversations"),
    client.listAllRecords<MessageFields>("messages"),
    client.listAllRecords<CorrectionFields>("corrections"),
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
    client.listAllRecords<DailyFeedbackFields>("dailyFeedbacks"),
    client.listAllRecords<TopicFields>("topics"),
    client.listAllRecords<Record<string, unknown>>("practiceSessions"),
    client.listAllRecords<FlashcardFields>("flashcards"),
    client.listAllRecords<FlashcardAttemptFields>("flashcardAttempts")
  ]);
  const profileId = profile?.id;
  const ownProfiles = profiles.filter((item) => item.fields.user_id === user.id);
  const scopedConversations = conversations.filter((item) => inScope(item, user.id, profileId));
  const conversationIds = new Set(scopedConversations.map((item) => item.id));
  const scopedWords = words.filter((item) => inScope(item, user.id, profileId));
  const wordIds = new Set(scopedWords.map((item) => item.id));
  const scopedPracticeSessions = practiceSessions.filter((item) => inScope(item, user.id, profileId));
  const practiceSessionIds = new Set(scopedPracticeSessions.map((item) => item.id));
  const scopedFlashcards = flashcards.filter((item) => practiceSessionIds.has(item.fields.practice_session_id));
  const flashcardIds = new Set(scopedFlashcards.map((item) => item.id));

  return {
    user,
    profile,
    profiles: ownProfiles,
    conversations: scopedConversations,
    messages: messages.filter((item) => conversationIds.has(item.fields.conversation_id)),
    corrections: corrections.filter((item) => conversationIds.has(item.fields.conversation_id)),
    words: scopedWords,
    wordOccurrences: wordOccurrences.filter((item) => wordIds.has(item.fields.word_id) || conversationIds.has(item.fields.conversation_id)),
    dailyFeedbacks: dailyFeedbacks.filter((item) => inScope(item, user.id, profileId)),
    topics: topics.filter((item) => inScope(item, user.id, profileId)),
    practiceSessions: scopedPracticeSessions,
    flashcards: scopedFlashcards,
    flashcardAttempts: flashcardAttempts.filter((item) => practiceSessionIds.has(item.fields.practice_session_id) || flashcardIds.has(item.fields.flashcard_id))
  };
}

function inScope<T extends { user_id?: string; language_profile_id?: string }>(
  record: TeableRecord<T>,
  userId: string,
  profileId?: string
) {
  return matchesLearningScope(record.fields, { userId, profileId });
}

function clampGoal(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizePhrase(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parsePayload(value: string | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
