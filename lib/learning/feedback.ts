import { createChatCompletion } from "@/lib/ai/client";
import { clampPausedMs } from "./chat-elapsed";
import { getTeableClient, TeableRecord } from "@/lib/supabase/client";
import {
  ConversationFields,
  CorrectionFields,
  getConversation,
  MessageFields,
  startConversation,
  WordFields,
  WordUsageSummaryFields
} from "./conversations";
import { DailyFeedbackFields } from "./home";
import { getActiveLanguageProfile, getSessionUser } from "./profile";
import { LearningStateError } from "./access";
import {
  getConversationSummaryAvailability,
  hasCompleteConversationSummaryFeedback,
  isMutableConversationStatus
} from "./conversation-state";
import { createTopic } from "./topics";
import { normalizeStoredInteractionMode } from "./chat-contracts";
import { listSensesByWordIds } from "./word-senses";
import type { PracticeSessionFields } from "./flashcards";
import { dateKeyInTimeZone, DEFAULT_TIMEZONE, resolveTimeZone } from "./tz";
import { evaluateAchievements } from "./achievements";
import { awardQuestXpIfNew, awardXp, XP_AMOUNTS } from "./xp";
import { buildDailyQuests, collectQuestInputs } from "./quests";
import { getDailyNewCardsQuota } from "./profile";

type ConversationSummary = {
  correction_score?: number;
  fluency_score?: number;
  strengths?: string;
  weaknesses?: string;
  recommended_focus?: string;
  recurring_errors?: string[];
  suggested_topics?: Array<{
    title: string;
    reason: string;
  }>;
};

export type CalendarDay = {
  date: string;
  day: number;
  hasFeedback: boolean;
  correctionScore?: number;
  fluencyScore?: number;
  flashcardMinutes: number;
  flashcardWords: number;
  flashcardCorrect: number;
};

export type CalendarSuggestion = {
  title: string;
  reason: string;
};

const COMPLETION_CACHE_TTL_MS = 30_000;
const MAX_COMPLETION_CACHE_ENTRIES = 24;
const completionCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof buildCompletionSummary>> }>();

const conversationEndLocks = new Map<string, Promise<Awaited<ReturnType<typeof finalizeConversation>>>>();

export async function endConversation(conversationId: string, options: { pausedMs?: number } = {}) {
  // Serializes concurrent /end calls for the same conversation: the second call
  // waits for the first, then sees the completed status below and returns the
  // persisted result instead of creating a duplicate daily feedback.
  const previous = conversationEndLocks.get(conversationId) ?? Promise.resolve(undefined);
  const current = previous.catch(() => undefined).then(() => finalizeConversation(conversationId, options));
  conversationEndLocks.set(conversationId, current);
  try {
    return await current;
  } finally {
    if (conversationEndLocks.get(conversationId) === current) conversationEndLocks.delete(conversationId);
  }
}

async function finalizeConversation(conversationId: string, options: { pausedMs?: number } = {}) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (!isMutableConversationStatus(context.conversation.fields.status)) {
    if (context.conversation.fields.status === "completed") return getPersistedCompletion(context);
    throw new LearningStateError("Esta conversa não pode ser encerrada neste estado.");
  }
  // O dia do feedback é o dia LOCAL do usuário (22h de São Paulo é o mesmo dia),
  // então todo o cálculo/persistência usa o fuso do perfil.
  const sessionUser = await getSessionUser();
  const timeZone = resolveTimeZone(sessionUser?.fields?.timezone);

  const client = getTeableClient();
  const endedAt = new Date().toISOString();
  const supportingData = Promise.all([
    client.listRecordsWhereAll<WordFields>("words", [
      { field: "user_id", value: context.conversation.fields.user_id },
      { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
    ]),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 300)
  ]);
  // The summary model can work from the transcript and corrections. Starting it
  // now overlaps its latency with the database reads needed for persistence.
  const summaryRequest = generateConversationSummary(
    context.conversation,
    context.topicTitle,
    context.messages,
    context.corrections,
    []
  );
  const [[words, feedbacks, conversations], summary] = await Promise.all([
    supportingData,
    summaryRequest
  ]);

  const conversationWords: TeableRecord<WordFields>[] = [];
  const pausedMs = clampPausedMs(options.pausedMs ?? 0, context.conversation.fields.started_at);
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(context.conversation.fields.started_at).getTime() - pausedMs) / 1000)
  );

  const [dailyFeedback, completedConversation] = await Promise.all([
    saveDailyFeedback(
      context.conversation,
      context.corrections,
      conversationWords,
      summary,
      endedAt,
      { feedbacks, conversations, timeZone }
    ),
    client.updateRecord<ConversationFields>("conversations", context.conversation.id, {
      status: "completed",
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      summary: summary.recommended_focus ?? summary.strengths ?? "Conversa concluída."
    })
  ]);

  await client.createEvent(context.conversation.fields.user_id, "conversation_completed", {
    conversation_id: context.conversation.id,
    daily_feedback_id: dailyFeedback.id,
    correction_score: dailyFeedback.fields.correction_score,
    fluency_score: dailyFeedback.fields.fluency_score,
    new_words_count: dailyFeedback.fields.new_words_count
  });

  // Conquistas: best-effort; nunca derrubam a conclusão da conversa.
  const achievementsUnlocked = await evaluateAchievements(context.conversation.fields.user_id).catch(() => []);

  // XP: best-effort — sessão já está salva; premiação não pode derrubá-la.
  try {
    if (context.profile) {
      const questInputs = await collectQuestInputs(
        context.conversation.fields.user_id,
        context.profile.id,
        timeZone,
        getDailyNewCardsQuota(sessionUser)
      );
      await awardQuestXpIfNew(context.conversation.fields.user_id, questInputs.dayStamp, buildDailyQuests(questInputs));
      await awardXp(context.conversation.fields.user_id, XP_AMOUNTS.conversation, "conversation");
    }
  } catch { /* XP é best-effort */ }

  const completionSummary = buildCompletionSummary(context, completedConversation, dailyFeedback, [], words);
  if (completionCache.size >= MAX_COMPLETION_CACHE_ENTRIES) {
    const oldestKey = completionCache.keys().next().value;
    if (oldestKey) completionCache.delete(oldestKey);
  }
  completionCache.set(conversationId, { expiresAt: Date.now() + COMPLETION_CACHE_TTL_MS, value: completionSummary });

  return {
    conversation: completedConversation,
    dailyFeedback,
    words: conversationWords,
    corrections: context.corrections,
    achievementsUnlocked,
    redirectTo: `/resumo?conversationId=${encodeURIComponent(context.conversation.id)}`
  };
}

async function getPersistedCompletion(
  context: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  timeZone: string = DEFAULT_TIMEZONE
) {
  const client = getTeableClient();
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", context.conversation.id),
    client.listRecordsWhereAll<WordFields>("words", [
      { field: "user_id", value: context.conversation.fields.user_id },
      { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
    ])
  ]);
  const date = toDateKey(context.conversation.fields.ended_at || context.conversation.fields.started_at, timeZone);
  const dailyFeedback = dailyFeedbacks.find(
    (feedback) =>
      feedback.fields.user_id === context.conversation.fields.user_id &&
      feedback.fields.language_profile_id === context.conversation.fields.language_profile_id &&
      toDateKey(feedback.fields.date, timeZone) === date
  );
  if (!dailyFeedback) throw new LearningStateError("O feedback desta conversa ainda não está disponível.", 409);
  const wordIds = new Set(
    usageSummaries
      .filter((summary) => summary.fields.conversation_id === context.conversation.id)
      .map((summary) => summary.fields.word_id)
  );
  return {
    conversation: context.conversation,
    dailyFeedback,
    words: words.filter((word) => wordIds.has(word.id)),
    corrections: context.corrections,
    redirectTo: `/resumo?conversationId=${encodeURIComponent(context.conversation.id)}`
  };
}

export async function getConversationSummary(conversationId: string) {
  const cached = completionCache.get(conversationId);
  if (cached) {
    completionCache.delete(conversationId);
    if (cached.expiresAt > Date.now()) return withVocabularyUsageStats(cached.value);
  }
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);

  if (getConversationSummaryAvailability(context.conversation.fields.status, true) === "not_completed") {
    throw new LearningStateError("Finalize esta conversa antes de abrir o resumo.", 409);
  }

  const client = getTeableClient();
  const summaryScopeFilters = [
    { field: "user_id", value: context.conversation.fields.user_id },
    { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
  ];
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listRecordsWhereAll<DailyFeedbackFields>("dailyFeedbacks", summaryScopeFilters),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", context.conversation.id),
    client.listRecordsWhereAll<WordFields>("words", summaryScopeFilters)
  ]);

  const timeZone = resolveTimeZone((await getSessionUser())?.fields?.timezone);
  const feedbackDate = toDateKey(context.conversation.fields.ended_at || context.conversation.fields.started_at, timeZone);
  const dailyFeedback =
    dailyFeedbacks.find(
      (feedback) =>
        feedback.fields.user_id === context.conversation.fields.user_id &&
        feedback.fields.language_profile_id === context.conversation.fields.language_profile_id &&
        toDateKey(feedback.fields.date, timeZone) === feedbackDate
    ) ?? null;

  const hasCompleteFeedback = Boolean(
    dailyFeedback &&
      hasCompleteConversationSummaryFeedback({
        correctionScore: dailyFeedback.fields.correction_score,
        newWordsCount: dailyFeedback.fields.new_words_count,
        recommendedFocus: dailyFeedback.fields.recommended_focus,
        strengths: dailyFeedback.fields.strengths
      })
  );

  if (getConversationSummaryAvailability(context.conversation.fields.status, hasCompleteFeedback) === "feedback_pending") {
    throw new LearningStateError("O feedback desta conversa ainda não está disponível.", 409);
  }

  const conversationUsage = usageSummaries.filter((summary) => summary.fields.conversation_id === context.conversation.id);
  const conversationWords = words.filter((word) =>
    conversationUsage.some((summary) => summary.fields.word_id === word.id)
  );

  return withVocabularyUsageStats({
    ...context,
    dailyFeedback: dailyFeedback!,
    words: conversationWords,
    vocabularyWords: words
  });
}

/**
 * Acrescenta usos por sentido das palavras da conversa e o contador de
 * palavras do banco nunca usadas. Roda sobre o resumo fresco e sobre o valor
 * do completionCache (que não carrega esses campos).
 */
async function withVocabularyUsageStats<T extends { words: TeableRecord<WordFields>[]; vocabularyWords: TeableRecord<WordFields>[] }>(summary: T) {
  const sensesByWord = await listSensesByWordIds(summary.words.map((word) => word.id));
  return {
    ...summary,
    wordSensesUsage: summary.words.flatMap((word) =>
      (sensesByWord.get(word.id) ?? []).map((sense) => ({
        wordId: word.id,
        translation: sense.fields.translation ?? "",
        isPrimary: sense.fields.is_primary === true,
        totalUses: Number(sense.fields.total_uses ?? 0)
      }))
    ),
    unusedWordCount: summary.vocabularyWords.filter((word) => Number(word.fields.total_uses ?? 0) === 0).length
  };
}

function buildCompletionSummary(
  context: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  conversation: TeableRecord<ConversationFields>,
  dailyFeedback: TeableRecord<DailyFeedbackFields>,
  usageSummaries: TeableRecord<WordUsageSummaryFields>[],
  words: TeableRecord<WordFields>[]
) {
  const conversationUsage = usageSummaries.filter((summary) => summary.fields.conversation_id === conversation.id);
  const wordIds = new Set(conversationUsage.map((summary) => summary.fields.word_id));
  return {
    ...context,
    conversation,
    dailyFeedback,
    words: words.filter((word) => wordIds.has(word.id)),
    vocabularyWords: words
  };
}

export async function addSavedWordsToDailyFeedback(conversation: TeableRecord<ConversationFields>, count: number) {
  const timeZone = resolveTimeZone((await getSessionUser())?.fields?.timezone);
  return addLearnedWordsToDailyFeedback(
    conversation.fields.user_id,
    conversation.fields.language_profile_id,
    toDateKey(conversation.fields.ended_at || conversation.fields.started_at, timeZone),
    count,
    timeZone
  );
}

/** Incrementa new_words_count do feedback do dia (usado por conversas e pela sessão de palavras novas). */
export async function addLearnedWordsToDailyFeedback(userId: string, profileId: string, dateKey: string, count: number, timeZone: string = DEFAULT_TIMEZONE) {
  if (count <= 0) return;
  const client = getTeableClient();
  const feedbacks = await client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180);
  const feedback = feedbacks.find((item) =>
    item.fields.user_id === userId &&
    item.fields.language_profile_id === profileId &&
    toDateKey(item.fields.date, timeZone) === dateKey
  );
  if (feedback) {
    await client.updateRecord<DailyFeedbackFields>("dailyFeedbacks", feedback.id, {
      new_words_count: Number(feedback.fields.new_words_count ?? 0) + count
    });
  }
}

export async function getCalendarData(monthInput?: string) {
  const client = getTeableClient();
  const user = await getSessionUser();
  const timeZone = resolveTimeZone(user.fields.timezone);
  const profile = await getActiveLanguageProfile(user);
  const scopeFilters = profile
    ? [
        { field: "user_id", value: user.id },
        { field: "language_profile_id", value: profile.id }
      ]
    : null;
  const [dailyFeedbacks, conversations, practiceSessions] = scopeFilters
    ? await Promise.all([
        client.listRecordsWhereAll<DailyFeedbackFields>("dailyFeedbacks", scopeFilters),
        client.listRecordsWhereAll<ConversationFields>("conversations", scopeFilters),
        client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters)
      ])
    : [[], [], []];
  const { year, month, key } = normalizeCalendarMonth(monthInput);
  const scoped = dailyFeedbacks;
  const validFeedbacks = scoped.filter((feedback) => safeDateKey(feedback.fields.date || feedback.fields.created_at, timeZone));
  const sorted = sortFeedbacks(validFeedbacks);
  const feedbackByDate = new Map<string, TeableRecord<DailyFeedbackFields>>();
  const flashcardsByDate = new Map<string, { minutes: number; words: number; correct: number }>();
  for (const session of practiceSessions.filter((item) => item.fields.type === "flashcards" && item.fields.status === "completed")) {
    const date = safeDateKey(session.fields.ended_at || session.fields.started_at, timeZone);
    if (!date || !date.startsWith(key)) continue;
    const current = flashcardsByDate.get(date) ?? { minutes: 0, words: 0, correct: 0 };
    current.minutes += Math.max(0, Math.round(Number(session.fields.duration_seconds ?? 0) / 60));
    current.words += Number(session.fields.selected_word_count ?? 0);
    current.correct += Number(session.fields.correct_count ?? 0);
    flashcardsByDate.set(date, current);
  }
  for (const feedback of sorted) {
    const date = safeDateKey(feedback.fields.date || feedback.fields.created_at, timeZone);
    if (date && date.startsWith(key) && !feedbackByDate.has(date)) feedbackByDate.set(date, feedback);
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days: CalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${key}-${String(day).padStart(2, "0")}`;
    const feedback = feedbackByDate.get(date);
    const flashcards = flashcardsByDate.get(date) ?? { minutes: 0, words: 0, correct: 0 };
    return {
      date,
      day,
      hasFeedback: Boolean(feedback),
      correctionScore: feedback?.fields.correction_score,
      fluencyScore: feedback?.fields.fluency_score,
      flashcardMinutes: flashcards.minutes,
      flashcardWords: flashcards.words,
      flashcardCorrect: flashcards.correct
    };
  });
  const latestFeedback = sorted[0] ?? null;
  const monthConversations = conversations.filter((conversation) =>
    conversation.fields.status === "completed" &&
    safeDateKey(conversation.fields.ended_at || conversation.fields.started_at, timeZone)?.startsWith(key)
  );
  const totalPracticeSeconds = monthConversations.reduce((sum, item) => sum + Number(item.fields.duration_seconds ?? 0), 0) + [...flashcardsByDate.values()].reduce((sum, item) => sum + item.minutes * 60, 0);
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const weekPracticeSeconds = conversations
    .filter((conversation) => conversation.fields.status === "completed" &&
      new Date(conversation.fields.ended_at || conversation.fields.started_at).getTime() >= sevenDaysAgo)
    .reduce((sum, item) => sum + Number(item.fields.duration_seconds ?? 0), 0);

  return {
    month: key,
    monthLabel: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 1))
    ),
    previousMonth: shiftMonth(key, -1),
    nextMonth: shiftMonth(key, 1),
    firstWeekday,
    days,
    feedbackCount: feedbackByDate.size,
    conversationCount: monthConversations.length,
    totalPracticeSeconds,
    weekPracticeSeconds,
    latestFeedback,
    suggestedTopics: parseSuggestedTopics(latestFeedback?.fields.suggested_topics)
  };
}

export async function getDailyFeedback(date: string) {
  if (!isDateKey(date)) return null;

  const client = getTeableClient();
  const user = await getSessionUser();
  const timeZone = resolveTimeZone(user.fields.timezone);
  const profile = await getActiveLanguageProfile(user);
  const scopeFilters = profile
    ? [
        { field: "user_id", value: user.id },
        { field: "language_profile_id", value: profile.id }
      ]
    : null;
  const [dailyFeedbacks, conversations] = scopeFilters
    ? await Promise.all([
        client.listRecordsWhereAll<DailyFeedbackFields>("dailyFeedbacks", scopeFilters),
        client.listRecordsWhereAll<ConversationFields>("conversations", scopeFilters)
      ])
    : [[], []];
  const feedback = sortFeedbacks(
    dailyFeedbacks.filter(
      (item) => safeDateKey(item.fields.date || item.fields.created_at, timeZone) === date
    )
  )[0] ?? null;
  const completedConversations = conversations
    .filter((conversation) => {
      const day = safeDateKey(conversation.fields.ended_at || conversation.fields.started_at, timeZone);
      return conversation.fields.status === "completed" && day === date;
    })
    .sort((a, b) => new Date(b.fields.ended_at || b.fields.started_at).getTime() - new Date(a.fields.ended_at || a.fields.started_at).getTime())
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.fields.Name || "Conversa livre",
      summary: conversation.fields.summary || "Conversa finalizada.",
      durationSeconds: Number(conversation.fields.duration_seconds ?? 0)
    }));

  return {
    date,
    feedback,
    completedConversations,
    recurringErrors: parseRecurringErrors(feedback?.fields.recurring_errors),
    suggestedTopics: parseSuggestedTopics(feedback?.fields.suggested_topics)
  };
}

export async function startCalendarPractice(date: string) {
  const detail = await getDailyFeedback(date);
  if (!detail?.feedback) throw new Error("Não existe feedback salvo para este dia.");

  const feedback = detail.feedback;
  const focus = feedback.fields.recommended_focus || feedback.fields.weaknesses || "retomar seu foco de aprendizado";
  const errors = detail.recurringErrors.join(", ");
  const title = `Retomar: ${shortText(focus, 54)}`;
  const reason = [
    `Esta prática retoma o feedback de ${formatDateLabel(date)}.`,
    `Foco principal: ${focus}.`,
    errors ? `Erros para observar: ${errors}.` : "Peça exemplos naturais e uma nova tentativa quando necessário.",
    "Conduza uma conversa curta, prática e conectada a esse histórico."
  ].join(" ");
  const created = await createTopic({
    title,
    source: "calendar_based",
    reason,
    relatedFeedbackId: feedback.id,
    difficulty: undefined
  });
  const result = await startConversation({
    topicId: created.topic.id,
    title,
    mode: "calendar_focus",
    source: "calendar_based",
    reason
  });

  await getTeableClient().createEvent(created.user.id, "calendar_feedback_practice_started", {
    date,
    daily_feedback_id: feedback.id,
    topic_id: created.topic.id,
    conversation_id: result.conversation.id,
    focus
  });

  return result;
}

async function generateConversationSummary(
  conversation: TeableRecord<ConversationFields>,
  topicTitle: string,
  messages: TeableRecord<MessageFields>[],
  corrections: TeableRecord<CorrectionFields>[],
  words: TeableRecord<WordFields>[]
): Promise<Required<ConversationSummary>> {
  const transcript = messages
    .slice(-12)
    .map((message) => `${message.fields.role}: ${message.fields.text}`)
    .join("\n");
  const correctionList = corrections
    .map((correction) => `${correction.fields.original_text} -> ${correction.fields.corrected_text}`)
    .join("; ");
  const wordList = words.map((word) => word.fields.display_text || word.fields.lemma).join(", ");

  try {
    const ai = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "Você gera resumo pedagógico de uma conversa de aprendizado de línguas. Responda somente JSON válido."
        },
        {
          role: "user",
          content: [
            `Tema: ${topicTitle}`,
            `Modo: ${conversation.fields.mode}`,
            `Tipo de interação: ${normalizeStoredInteractionMode(conversation.fields.interaction_mode)}`,
            `Transcrição:\n${transcript}`,
            `Correções: ${correctionList || "nenhuma"}`,
            `Palavras: ${wordList || "nenhuma"}`,
            "Gere JSON com correction_score, fluency_score, strengths, weaknesses, recommended_focus, recurring_errors, suggested_topics.",
            "Scores de 0 a 10. suggested_topics é array com objetos title/reason."
          ].join("\n\n")
        }
      ],
      { temperature: 0.3, maxTokens: 420, timeoutMs: 8_000, disableThinking: true }
    );
    return normalizeSummary(parseSummary(ai.content), corrections, words);
  } catch {
    return normalizeSummary({}, corrections, words);
  }
}

async function saveDailyFeedback(
  conversation: TeableRecord<ConversationFields>,
  corrections: TeableRecord<CorrectionFields>[],
  words: TeableRecord<WordFields>[],
  summary: Required<ConversationSummary>,
  endedAt: string,
  preloaded?: {
    feedbacks: TeableRecord<DailyFeedbackFields>[];
    conversations: TeableRecord<ConversationFields>[];
    timeZone?: string;
  }
) {
  const client = getTeableClient();
  const timeZone = resolveTimeZone(preloaded?.timeZone);
  const date = toDateKey(endedAt, timeZone);
  const [feedbacks, conversations] = preloaded
    ? [preloaded.feedbacks, preloaded.conversations]
    : await Promise.all([
        client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
        client.listRecords<ConversationFields>("conversations", 300)
      ]);
  const existing = feedbacks.find(
    (feedback) =>
      feedback.fields.user_id === conversation.fields.user_id &&
      feedback.fields.language_profile_id === conversation.fields.language_profile_id &&
      toDateKey(feedback.fields.date, timeZone) === date
  );

  const previousCompletedCount = conversations.filter(
    (item) =>
      item.id !== conversation.id &&
      item.fields.status === "completed" &&
      item.fields.user_id === conversation.fields.user_id &&
      item.fields.language_profile_id === conversation.fields.language_profile_id &&
      toDateKey(item.fields.ended_at || item.fields.started_at, timeZone) === date
  ).length;
  const fields = aggregateDailyFeedback(existing?.fields, summary, words.length, Math.max(1, previousCompletedCount), {
    Name: date,
    user_id: conversation.fields.user_id,
    language_profile_id: conversation.fields.language_profile_id,
    date,
    created_at: existing?.fields.created_at ?? endedAt
  });

  return existing
    ? client.updateRecord<DailyFeedbackFields>("dailyFeedbacks", existing.id, fields)
    : client.createRecord<DailyFeedbackFields>("dailyFeedbacks", fields);
}

export function aggregateDailyFeedback(
  existing: DailyFeedbackFields | undefined,
  summary: Required<ConversationSummary>,
  newWords: number,
  previousSessions: number,
  identity: Pick<DailyFeedbackFields, "user_id" | "language_profile_id" | "date" | "created_at"> & { Name?: string }
): DailyFeedbackFields & { Name?: string } {
  const previousWeight = existing ? Math.max(1, previousSessions) : 0;
  const totalWeight = previousWeight + 1;
  const recurringErrors = uniqueStrings([...parseRecurringErrors(existing?.recurring_errors), ...summary.recurring_errors]);
  const suggestedTopics = uniqueSuggestedTopics([...parseSuggestedTopics(existing?.suggested_topics), ...summary.suggested_topics]);
  return {
    ...identity,
    strengths: summary.strengths,
    weaknesses: summary.weaknesses,
    recommended_focus: summary.recommended_focus,
    recurring_errors: JSON.stringify(recurringErrors),
    new_words_count: Number(existing?.new_words_count ?? 0) + newWords,
    correction_score: weightedScore(existing?.correction_score, summary.correction_score, previousWeight, totalWeight),
    fluency_score: weightedScore(existing?.fluency_score, summary.fluency_score, previousWeight, totalWeight),
    suggested_topics: JSON.stringify(suggestedTopics),
    created_at: identity.created_at
  };
}

function parseSummary(content: string): ConversationSummary {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as ConversationSummary;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as ConversationSummary;
    } catch {
      return {};
    }
  }
}

function normalizeSummary(
  summary: ConversationSummary,
  corrections: TeableRecord<CorrectionFields>[],
  words: TeableRecord<WordFields>[]
): Required<ConversationSummary> {
  const recurringErrors = summary.recurring_errors?.length
    ? summary.recurring_errors
    : [...new Set(corrections.map((correction) => correction.fields.error_type))].slice(0, 3);

  return {
    correction_score: clampScore(summary.correction_score ?? Math.max(6, 10 - corrections.length)),
    fluency_score: clampScore(summary.fluency_score ?? (corrections.length > 2 ? 7 : 8)),
    strengths: summary.strengths?.trim() || "Você manteve a conversa ativa e respondeu com clareza.",
    weaknesses:
      summary.weaknesses?.trim() ||
      (corrections[0]?.fields.explanation ?? "Continue praticando para aumentar naturalidade e precisão."),
    recommended_focus:
      summary.recommended_focus?.trim() ||
      (recurringErrors[0] ? `Praticar ${recurringErrors[0]} em frases curtas.` : "Expandir respostas com mais detalhes."),
    recurring_errors: recurringErrors,
    suggested_topics: summary.suggested_topics?.length
      ? summary.suggested_topics.slice(0, 3)
      : [
          {
            title: "Rotina de amanhã",
            reason: "Pratica passado, presente e planos simples."
          },
          {
            title: words[0]?.fields.display_text ? `Usando ${words[0].fields.display_text}` : "Revisão de vocabulário",
            reason: "Reforça palavras capturadas na conversa."
          }
        ]
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(10, Math.round(value)));
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toDateKey(value: string, timeZone: string = DEFAULT_TIMEZONE) {
  // Valores que já são chaves de dia (YYYY-MM-DD) passam direto: reconvertê-los
  // como UTC-meia-noite deslocaria a chave um dia no fuso local.
  if (DAY_KEY_PATTERN.test(value)) return value;
  return dateKeyInTimeZone(new Date(value), resolveTimeZone(timeZone));
}

function safeDateKey(value: string | undefined, timeZone: string = DEFAULT_TIMEZONE) {
  if (!value) return null;
  if (DAY_KEY_PATTERN.test(value)) return value;
  const key = dateKeyInTimeZone(new Date(value), resolveTimeZone(timeZone));
  return key || null;
}

export function parseSuggestedTopics(value: string | undefined): CalendarSuggestion[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<{ title?: string; reason?: string }>;
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item.title)
          .map((item) => ({ title: item.title ?? "Próximo tema", reason: item.reason ?? "Sugerido pelo feedback." }))
      : [];
  } catch {
    return [];
  }
}

export function normalizeCalendarMonth(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  const validMonth = month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1;
  const validYear = year >= 2000 && year <= 2100 ? year : now.getUTCFullYear();
  return { year: validYear, month: validMonth, key: `${validYear}-${String(validMonth).padStart(2, "0")}` };
}

function sortFeedbacks(feedbacks: TeableRecord<DailyFeedbackFields>[]) {
  return [...feedbacks].sort(
    (a, b) => dateNumber(b.fields.date || b.fields.created_at) - dateNumber(a.fields.date || a.fields.created_at)
  );
}

function parseRecurringErrors(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return value.trim() ? [value.trim()] : [];
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
}

function uniqueSuggestedTopics(topics: CalendarSuggestion[]) {
  const seen = new Set<string>();
  return topics.filter((topic) => {
    const key = topic.title.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function weightedScore(existing: number | undefined, current: number, previousWeight: number, totalWeight: number) {
  if (!previousWeight || !Number.isFinite(Number(existing))) return current;
  return Math.round(((Number(existing) * previousWeight + current) / totalWeight) * 10) / 10;
}

function shiftMonth(month: string, amount: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function dateNumber(value: string | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function shortText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}
