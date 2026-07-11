import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import {
  ConversationFields,
  CorrectionFields,
  getConversation,
  MessageFields,
  startConversation,
  WordFields,
  WordOccurrenceFields
} from "./conversations";
import { DailyFeedbackFields } from "./home";
import { getActiveLanguageProfile, getOrCreatePersonalUser } from "./profile";
import { LearningStateError } from "./access";
import {
  getConversationSummaryAvailability,
  hasCompleteConversationSummaryFeedback,
  isMutableConversationStatus
} from "./conversation-state";
import { matchesLearningScope } from "./scope";
import { createTopic } from "./topics";
import type { PracticeSessionFields } from "./flashcards";

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

export async function endConversation(conversationId: string) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (!isMutableConversationStatus(context.conversation.fields.status)) {
    if (context.conversation.fields.status === "completed") return getPersistedCompletion(context);
    throw new LearningStateError("Esta conversa não pode ser encerrada neste estado.");
  }

  const client = getTeableClient();
  const [wordOccurrences, words] = await Promise.all([
    client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
    client.listAllRecords<WordFields>("words")
  ]);

  const conversationOccurrences = wordOccurrences.filter(
    (occurrence) => occurrence.fields.conversation_id === context.conversation.id
  );
  const conversationWords = words.filter((word) =>
    conversationOccurrences.some((occurrence) => occurrence.fields.word_id === word.id) &&
    matchesLearningScope(word.fields, {
      userId: context.conversation.fields.user_id,
      profileId: context.conversation.fields.language_profile_id
    })
  );
  const summary = await generateConversationSummary(
    context.conversation,
    context.topicTitle,
    context.messages,
    context.corrections,
    conversationWords
  );
  const endedAt = new Date().toISOString();
  const dailyFeedback = await saveDailyFeedback(
    context.conversation,
    context.corrections,
    conversationWords,
    summary,
    endedAt
  );

  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(context.conversation.fields.started_at).getTime()) / 1000)
  );

  const completedConversation = await client.updateRecord<ConversationFields>("conversations", context.conversation.id, {
    status: "completed",
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    summary: summary.recommended_focus ?? summary.strengths ?? "Conversa concluída."
  });

  await client.createEvent(context.conversation.fields.user_id, "conversation_completed", {
    conversation_id: context.conversation.id,
    daily_feedback_id: dailyFeedback.id,
    correction_score: dailyFeedback.fields.correction_score,
    fluency_score: dailyFeedback.fields.fluency_score,
    new_words_count: dailyFeedback.fields.new_words_count
  });

  return {
    conversation: completedConversation,
    dailyFeedback,
    words: conversationWords,
    corrections: context.corrections,
    redirectTo: `/resumo?conversationId=${encodeURIComponent(context.conversation.id)}`
  };
}

async function getPersistedCompletion(context: NonNullable<Awaited<ReturnType<typeof getConversation>>>) {
  const client = getTeableClient();
  const [dailyFeedbacks, wordOccurrences, words] = await Promise.all([
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
    client.listAllRecords<WordFields>("words")
  ]);
  const date = toDateKey(context.conversation.fields.ended_at || context.conversation.fields.started_at);
  const dailyFeedback = dailyFeedbacks.find(
    (feedback) =>
      feedback.fields.user_id === context.conversation.fields.user_id &&
      feedback.fields.language_profile_id === context.conversation.fields.language_profile_id &&
      toDateKey(feedback.fields.date) === date
  );
  if (!dailyFeedback) throw new LearningStateError("O feedback desta conversa ainda não está disponível.", 409);
  const wordIds = new Set(
    wordOccurrences
      .filter((occurrence) => occurrence.fields.conversation_id === context.conversation.id)
      .map((occurrence) => occurrence.fields.word_id)
  );
  return {
    conversation: context.conversation,
    dailyFeedback,
    words: words.filter((word) =>
      wordIds.has(word.id) &&
      matchesLearningScope(word.fields, {
        userId: context.conversation.fields.user_id,
        profileId: context.conversation.fields.language_profile_id
      })
    ),
    corrections: context.corrections,
    redirectTo: `/resumo?conversationId=${encodeURIComponent(context.conversation.id)}`
  };
}

export async function getConversationSummary(conversationId: string) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);

  if (getConversationSummaryAvailability(context.conversation.fields.status, true) === "not_completed") {
    throw new LearningStateError("Finalize esta conversa antes de abrir o resumo.", 409);
  }

  const client = getTeableClient();
  const [dailyFeedbacks, wordOccurrences, words] = await Promise.all([
    client.listAllRecords<DailyFeedbackFields>("dailyFeedbacks"),
    client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
    client.listAllRecords<WordFields>("words")
  ]);

  const feedbackDate = toDateKey(context.conversation.fields.ended_at || context.conversation.fields.started_at);
  const dailyFeedback =
    dailyFeedbacks.find(
      (feedback) =>
        feedback.fields.user_id === context.conversation.fields.user_id &&
        feedback.fields.language_profile_id === context.conversation.fields.language_profile_id &&
        toDateKey(feedback.fields.date) === feedbackDate
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

  const occurrences = wordOccurrences.filter((occurrence) => occurrence.fields.conversation_id === context.conversation.id);
  const conversationWords = words.filter((word) =>
    occurrences.some((occurrence) => occurrence.fields.word_id === word.id) &&
    matchesLearningScope(word.fields, {
      userId: context.conversation.fields.user_id,
      profileId: context.conversation.fields.language_profile_id
    })
  );

  return {
    ...context,
    dailyFeedback: dailyFeedback!,
    words: conversationWords,
    vocabularyWords: words.filter((word) => matchesLearningScope(word.fields, {
      userId: context.conversation.fields.user_id,
      profileId: context.conversation.fields.language_profile_id
    })),
    occurrences
  };
}

export async function addSavedWordsToDailyFeedback(conversation: TeableRecord<ConversationFields>, count: number) {
  if (count <= 0) return;
  const client = getTeableClient();
  const feedbacks = await client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180);
  const date = toDateKey(conversation.fields.ended_at || conversation.fields.started_at);
  const feedback = feedbacks.find((item) =>
    item.fields.user_id === conversation.fields.user_id &&
    item.fields.language_profile_id === conversation.fields.language_profile_id &&
    toDateKey(item.fields.date) === date
  );
  if (feedback) {
    await client.updateRecord<DailyFeedbackFields>("dailyFeedbacks", feedback.id, {
      new_words_count: Number(feedback.fields.new_words_count ?? 0) + count
    });
  }
}

export async function getCalendarData(monthInput?: string) {
  const client = getTeableClient();
  const [user, dailyFeedbacks, conversations, practiceSessions] = await Promise.all([
    getOrCreatePersonalUser(),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 400),
    client.listRecords<PracticeSessionFields>("practiceSessions", 400)
  ]);
  const profile = await getActiveLanguageProfile(user);
  const { year, month, key } = normalizeCalendarMonth(monthInput);
  const scoped = dailyFeedbacks.filter((feedback) => matchesFeedbackScope(feedback, user.id, profile?.id));
  const validFeedbacks = scoped.filter((feedback) => safeDateKey(feedback.fields.date || feedback.fields.created_at));
  const sorted = sortFeedbacks(validFeedbacks);
  const feedbackByDate = new Map<string, TeableRecord<DailyFeedbackFields>>();
  const flashcardsByDate = new Map<string, { minutes: number; words: number; correct: number }>();
  for (const session of practiceSessions.filter((item) => item.fields.type === "flashcards" && item.fields.status === "completed" && matchesLearningScope(item.fields, { userId: user.id, profileId: profile?.id }))) {
    const date = safeDateKey(session.fields.ended_at || session.fields.started_at);
    if (!date || !date.startsWith(key)) continue;
    const current = flashcardsByDate.get(date) ?? { minutes: 0, words: 0, correct: 0 };
    current.minutes += Math.max(0, Math.round(Number(session.fields.duration_seconds ?? 0) / 60));
    current.words += Number(session.fields.selected_word_count ?? 0);
    current.correct += Number(session.fields.correct_count ?? 0);
    flashcardsByDate.set(date, current);
  }
  for (const feedback of sorted) {
    const date = safeDateKey(feedback.fields.date || feedback.fields.created_at);
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
    matchesLearningScope(conversation.fields, { userId: user.id, profileId: profile?.id }) &&
    safeDateKey(conversation.fields.ended_at || conversation.fields.started_at)?.startsWith(key)
  );
  const totalPracticeSeconds = monthConversations.reduce((sum, item) => sum + Number(item.fields.duration_seconds ?? 0), 0) + [...flashcardsByDate.values()].reduce((sum, item) => sum + item.minutes * 60, 0);
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const weekPracticeSeconds = conversations
    .filter((conversation) => conversation.fields.status === "completed" &&
      matchesLearningScope(conversation.fields, { userId: user.id, profileId: profile?.id }) &&
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
  const [user, dailyFeedbacks, conversations] = await Promise.all([
    getOrCreatePersonalUser(),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 220)
  ]);
  const profile = await getActiveLanguageProfile(user);
  const feedback = sortFeedbacks(
    dailyFeedbacks.filter(
      (item) => matchesFeedbackScope(item, user.id, profile?.id) && safeDateKey(item.fields.date || item.fields.created_at) === date
    )
  )[0] ?? null;
  const completedConversations = conversations
    .filter((conversation) => {
      const day = safeDateKey(conversation.fields.ended_at || conversation.fields.started_at);
      return matchesLearningScope(conversation.fields, { userId: user.id, profileId: profile?.id }) &&
        conversation.fields.status === "completed" && day === date;
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
    .slice(-16)
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
            `Transcrição:\n${transcript}`,
            `Correções: ${correctionList || "nenhuma"}`,
            `Palavras: ${wordList || "nenhuma"}`,
            "Gere JSON com correction_score, fluency_score, strengths, weaknesses, recommended_focus, recurring_errors, suggested_topics.",
            "Scores de 0 a 10. suggested_topics é array com objetos title/reason."
          ].join("\n\n")
        }
      ],
      { temperature: 0.35, maxTokens: 800 }
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
  endedAt: string
) {
  const client = getTeableClient();
  const date = toDateKey(endedAt);
  const [feedbacks, conversations] = await Promise.all([
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 300)
  ]);
  const existing = feedbacks.find(
    (feedback) =>
      feedback.fields.user_id === conversation.fields.user_id &&
      feedback.fields.language_profile_id === conversation.fields.language_profile_id &&
      toDateKey(feedback.fields.date) === date
  );

  const previousCompletedCount = conversations.filter(
    (item) =>
      item.id !== conversation.id &&
      item.fields.status === "completed" &&
      item.fields.user_id === conversation.fields.user_id &&
      item.fields.language_profile_id === conversation.fields.language_profile_id &&
      toDateKey(item.fields.ended_at || item.fields.started_at) === date
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

function toDateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function safeDateKey(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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

function matchesFeedbackScope(feedback: TeableRecord<DailyFeedbackFields>, userId: string, profileId?: string) {
  return matchesLearningScope(feedback.fields, { userId, profileId });
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
