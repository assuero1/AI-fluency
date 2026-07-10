import type { TeableClient, TeableRecord } from "@/lib/teable/client";
import type { ConversationFields, CorrectionFields, MessageFields, WordFields } from "./conversations";
import type { LanguageProfileFields } from "./profile";

type TopicFields = {
  Name?: string;
  user_id?: string;
  language_profile_id?: string;
  title?: string;
  created_at?: string;
};

type DailyFeedbackFields = {
  user_id?: string;
  language_profile_id?: string;
  recommended_focus?: string;
  created_at?: string;
  date?: string;
};

export type TutorContext = {
  dueWords: string[];
  recurringErrors: Array<{ type: string; example: string }>;
  recentTopics: string[];
  calendarFocus?: string;
  recentHistory: Array<{ role: "user" | "assistant"; text: string }>;
};

type TutorKnowledge = Omit<TutorContext, "recentHistory">;

const TUTOR_CONTEXT_TTL_MS = 45_000;
const MAX_TUTOR_CONTEXT_ENTRIES = 24;
const tutorKnowledgeCache = new Map<string, { expiresAt: number; promise: Promise<TutorKnowledge> }>();

export async function getTutorContext(input: {
  client: TeableClient;
  userId: string;
  profile: TeableRecord<LanguageProfileFields> | null;
  history: TeableRecord<MessageFields>[];
}) {
  const profileId = input.profile?.id;
  const cacheKey = `${input.userId}:${profileId ?? "no-profile"}`;
  const now = Date.now();
  let cached = tutorKnowledgeCache.get(cacheKey);
  if (!cached || cached.expiresAt <= now) {
    if (cached) tutorKnowledgeCache.delete(cacheKey);
    cached = {
      expiresAt: now + TUTOR_CONTEXT_TTL_MS,
      promise: loadTutorKnowledge(input.client, input.userId, profileId, Boolean(input.profile?.fields.calendar_memory_enabled))
    };
    if (tutorKnowledgeCache.size >= MAX_TUTOR_CONTEXT_ENTRIES) {
      const oldestKey = tutorKnowledgeCache.keys().next().value;
      if (oldestKey) tutorKnowledgeCache.delete(oldestKey);
    }
    tutorKnowledgeCache.set(cacheKey, cached);
    cached.promise.catch(() => tutorKnowledgeCache.delete(cacheKey));
  }

  const knowledge = await cached.promise;
  return {
    ...knowledge,
    recentHistory: input.history.slice(-8).map((message) => ({
      role: message.fields.role === "assistant" ? "assistant" : "user",
      text: message.fields.text.slice(0, 600)
    }))
  } satisfies TutorContext;
}

async function loadTutorKnowledge(
  client: TeableClient,
  userId: string,
  profileId: string | undefined,
  calendarMemoryEnabled: boolean
): Promise<TutorKnowledge> {
  const [words, corrections, conversations, topics, feedbacks] = await Promise.all([
    client.listRecords<WordFields>("words", 300),
    client.listRecords<CorrectionFields>("corrections", 300),
    client.listRecords<ConversationFields>("conversations", 300),
    client.listRecords<TopicFields>("topics", 150),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 90)
  ]);
  const conversationIds = new Set(
    conversations
      .filter((conversation) => conversation.fields.user_id === userId && conversation.fields.language_profile_id === profileId)
      .map((conversation) => conversation.id)
  );
  const now = Date.now();
  const dueWords = words
    .filter((word) => word.fields.user_id === userId && word.fields.language_profile_id === profileId)
    .filter((word) => !word.fields.review_due_at || Date.parse(word.fields.review_due_at) <= now)
    .sort((left, right) => Date.parse(right.fields.last_used_at || "") - Date.parse(left.fields.last_used_at || ""))
    .slice(0, 5)
    .map((word) => word.fields.display_text || word.fields.lemma)
    .filter(Boolean);
  const errors = corrections.filter((correction) => conversationIds.has(correction.fields.conversation_id));
  const recurringErrors = Object.entries(
    errors.reduce<Record<string, CorrectionFields[]>>((groups, correction) => {
      const type = correction.fields.error_type || "grammar";
      (groups[type] ??= []).push(correction.fields);
      return groups;
    }, {})
  )
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 3)
    .map(([type, items]) => ({ type, example: `${items[0].original_text} -> ${items[0].corrected_text}` }));
  const recentTopics = topics
    .filter((topic) => topic.fields.user_id === userId && topic.fields.language_profile_id === profileId)
    .sort((left, right) => Date.parse(right.fields.created_at || "") - Date.parse(left.fields.created_at || ""))
    .slice(0, 4)
    .map((topic) => topic.fields.title || topic.fields.Name)
    .filter((topic): topic is string => Boolean(topic));
  const calendarFocus = calendarMemoryEnabled
    ? feedbacks
        .filter((feedback) => feedback.fields.user_id === userId && feedback.fields.language_profile_id === profileId)
        .sort((left, right) => Date.parse(right.fields.date || right.fields.created_at || "") - Date.parse(left.fields.date || left.fields.created_at || ""))[0]
        ?.fields.recommended_focus
    : undefined;

  return {
    dueWords,
    recurringErrors,
    recentTopics,
    calendarFocus
  };
}

export function formatTutorContext(context: TutorContext) {
  return [
    context.dueWords.length ? `Palavras para revisar em breve: ${context.dueWords.join(", ")}.` : "",
    context.recurringErrors.length
      ? `Erros recorrentes: ${context.recurringErrors.map((item) => `${item.type} (${item.example})`).join("; ")}.`
      : "",
    context.recentTopics.length ? `Temas recentes: ${context.recentTopics.join(", ")}.` : "",
    context.calendarFocus ? `Foco indicado pelo calendário: ${context.calendarFocus}.` : ""
  ].filter(Boolean).join("\n");
}
