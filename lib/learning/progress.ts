import { createTopic } from "./topics";
import { startConversation } from "./conversations";
import type { ConversationFields, CorrectionFields, WordFields } from "./conversations";
import type { DailyFeedbackFields } from "./home";
import { getActiveLanguageProfile, getOrCreatePersonalUser } from "./profile";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import { matchesLearningScope } from "./scope";
import { getPracticeActivity } from "./practice-activity";
import type { PracticeSessionFields } from "./flashcards";

type ProgressError = {
  type: string;
  count: number;
  example?: {
    original: string;
    corrected: string;
  };
};

type ProgressStrength = {
  title: string;
  meta: string;
  tone: "primary" | "info" | "warning";
};

export async function getProgressData() {
  const client = getTeableClient();
  const [user, conversations, corrections, words, feedbacks, practiceSessions] = await Promise.all([
    getOrCreatePersonalUser(),
    client.listRecords<ConversationFields>("conversations", 300),
    client.listRecords<CorrectionFields>("corrections", 400),
    client.listRecords<WordFields>("words", 300),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<PracticeSessionFields>("practiceSessions", 400)
  ]);
  const profile = await getActiveLanguageProfile(user);
  const scopedConversations = conversations.filter((conversation) => matchesConversationScope(conversation, user.id, profile?.id));
  const completedConversations = scopedConversations.filter((conversation) => conversation.fields.status === "completed");
  const scopedWords = words.filter(
    (word) =>
      matchesRecordScope(word, user.id, profile?.id) && Boolean(word.fields.display_text?.trim() || word.fields.lemma?.trim())
  );
  const scopedFeedbacks = feedbacks.filter((feedback) => matchesRecordScope(feedback, user.id, profile?.id)).sort(sortByFeedbackDate);
  const conversationIds = new Set(scopedConversations.map((conversation) => conversation.id));
  const scopedCorrections = corrections.filter((correction) => conversationIds.has(correction.fields.conversation_id));
  const now = new Date();
  const currentMonth = monthKey(now);
  const previousMonth = shiftMonth(currentMonth, -1);
  const currentMonthFeedbacks = scopedFeedbacks.filter((feedback) => dateKey(feedback.fields.date || feedback.fields.created_at).startsWith(currentMonth));
  const previousMonthFeedbacks = scopedFeedbacks.filter((feedback) => dateKey(feedback.fields.date || feedback.fields.created_at).startsWith(previousMonth));
  const currentFluency = average(currentMonthFeedbacks.map((feedback) => Number(feedback.fields.fluency_score ?? 0)));
  const previousFluency = average(previousMonthFeedbacks.map((feedback) => Number(feedback.fields.fluency_score ?? 0)));
  const fluencyChange = currentFluency > 0 && previousFluency > 0 ? Math.round(((currentFluency - previousFluency) / previousFluency) * 100) : null;
  const newWordsMonth = scopedWords.filter((word) => dateKey(word.fields.first_used_at).startsWith(currentMonth)).length;
  const monthlyConversations = completedConversations.filter((conversation) =>
    dateKey(conversation.fields.ended_at || conversation.fields.started_at).startsWith(currentMonth)
  );
  const completedFlashcards = practiceSessions.filter((session) => session.fields.type === "flashcards" && session.fields.status === "completed" && matchesLearningScope(session.fields, { userId: user.id, profileId: profile?.id }));
  const flashcardSeconds = completedFlashcards.reduce((sum, session) => sum + Number(session.fields.duration_seconds ?? 0), 0);
  const flashcardWords = completedFlashcards.reduce((sum, session) => sum + Number(session.fields.selected_word_count ?? 0), 0);
  const recoveredWords = completedFlashcards.reduce((sum, session) => {
    const focus = parseSessionFocus(session.fields.focus);
    return sum + Number(focus.result?.recoveredCards ?? 0);
  }, 0);
  const errors = buildRecurringErrors(scopedCorrections, scopedConversations, now);
  const latestFeedback = scopedFeedbacks[0] ?? null;
  const practice = getPracticeActivity(
    [...completedConversations.map((conversation) => conversation.fields.ended_at || conversation.fields.started_at), ...completedFlashcards.map((session) => session.fields.ended_at || session.fields.started_at)],
    { now, timeZone: user.fields.timezone ?? "UTC" }
  );
  const strengths = buildStrengths({
    completedCount: completedConversations.length,
    totalWordUses: scopedWords.reduce((sum, word) => sum + Number(word.fields.total_uses ?? 0), 0),
    fluency: currentFluency || Number(latestFeedback?.fields.fluency_score ?? 0),
    latestStrength: latestFeedback?.fields.strengths
  });
  const focus = buildWeeklyFocus(errors, latestFeedback, newWordsMonth);

  return {
    profile: {
      languageName: profile?.fields.language_name ?? "Idioma ativo",
      level: profile?.fields.level ?? "Ainda não definido",
      levelProgress: levelProgress(profile?.fields.level),
      monthlyFluency: currentFluency || Number(latestFeedback?.fields.fluency_score ?? 0),
      fluencyChange,
      monthlyConversations: monthlyConversations.length
    },
    metrics: {
      correctionScore: average(currentMonthFeedbacks.map((feedback) => Number(feedback.fields.correction_score ?? 0))) || Number(latestFeedback?.fields.correction_score ?? 0),
      recurringErrors: errors.length,
      newWordsMonth,
      completedConversations: completedConversations.length,
      flashcardWords,
      flashcardMinutes: Math.round(flashcardSeconds / 60),
      consolidatedWords: scopedWords.filter((word) => word.fields.review_state === "review").length,
      difficultWords: scopedWords.filter((word) => word.fields.review_state === "difficult").length,
      recoveredWords
    },
    strengths,
    focus,
    errors,
    streak: practice.streak,
    activityDays: practice.activityDays
  };
}

function parseSessionFocus(value: string | undefined) { try { return JSON.parse(value || "{}") as { result?: { recoveredCards?: number } }; } catch { return {}; } }

export async function startProgressFocusPractice() {
  const progress = await getProgressData();
  const title = `Foco da semana: ${progress.focus.title}`;
  const reason = [
    `Foco de aprendizagem: ${progress.focus.title}.`,
    progress.focus.reason,
    "Conduza uma conversa curta no idioma alvo, peça exemplos naturais e corrija este ponto de forma clara."
  ].join(" ");
  const created = await createTopic({
    title,
    source: "recurring_error",
    reason,
    difficulty: undefined
  });
  const result = await startConversation({
    topicId: created.topic.id,
    title,
    mode: "custom_topic",
    source: "recurring_error",
    reason
  });

  await getTeableClient().createEvent(created.user.id, "progress_focus_practice_started", {
    conversation_id: result.conversation.id,
    topic_id: created.topic.id,
    focus: progress.focus.title,
    source: progress.focus.source
  });

  return result;
}

function buildRecurringErrors(
  corrections: TeableRecord<CorrectionFields>[],
  conversations: TeableRecord<ConversationFields>[],
  now: Date
): ProgressError[] {
  const recentBoundary = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const recent = corrections.filter((correction) => {
    const conversation = conversations.find((item) => item.id === correction.fields.conversation_id);
    const timestamp = dateNumber(correction.fields.created_at || conversation?.fields.ended_at || conversation?.fields.started_at);
    return timestamp >= recentBoundary;
  });
  const grouped = new Map<string, TeableRecord<CorrectionFields>[]>();
  for (const correction of recent) {
    const type = correction.fields.error_type || "grammar";
    grouped.set(type, [...(grouped.get(type) ?? []), correction]);
  }

  return [...grouped.entries()]
    .map(([type, records]) => {
      const latest = [...records].sort((a, b) => dateNumber(b.fields.created_at) - dateNumber(a.fields.created_at))[0];
      return {
        type,
        count: records.length,
        example: latest
          ? {
              original: latest.fields.original_text,
              corrected: latest.fields.corrected_text
            }
          : undefined
      };
    })
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildStrengths(input: {
  completedCount: number;
  totalWordUses: number;
  fluency: number;
  latestStrength?: string;
}): ProgressStrength[] {
  const strengths: ProgressStrength[] = [];
  if (input.completedCount > 0) {
    strengths.push({
      title: "Consistência de prática",
      meta: `${input.completedCount} conversa(s) concluída(s) no seu histórico.`,
      tone: "primary"
    });
  }
  if (input.totalWordUses > 0) {
    strengths.push({
      title: "Vocabulário em uso",
      meta: `${input.totalWordUses} uso(s) de palavras registrados em conversas.`,
      tone: "info"
    });
  }
  if (input.fluency >= 7) {
    strengths.push({
      title: "Fluidez em evolução",
      meta: input.latestStrength || `Fluidez recente: ${input.fluency}/10.`,
      tone: "warning"
    });
  }
  return strengths.length
    ? strengths.slice(0, 3)
    : [{ title: "Primeira evidência a caminho", meta: "Conclua uma conversa para gerar seu panorama de fluência.", tone: "primary" }];
}

function buildWeeklyFocus(errors: ProgressError[], feedback: TeableRecord<DailyFeedbackFields> | null, newWordsMonth: number) {
  const mainError = errors[0];
  if (mainError) {
    const example = mainError.example?.original && mainError.example.corrected
      ? ` Exemplo recente: “${mainError.example.original}” → “${mainError.example.corrected}”.`
      : "";
    return {
      title: `${errorLabel(mainError.type)} em contexto`,
      detail: `${mainError.count} correção(ões) desse tipo nos últimos 30 dias.`,
      reason: `Retome ${errorLabel(mainError.type).toLocaleLowerCase()} com frases naturais e uma nova tentativa.${example}`,
      source: "recurring_error"
    };
  }
  if (feedback?.fields.recommended_focus) {
    return {
      title: shortText(feedback.fields.recommended_focus, 58),
      detail: "Foco indicado no seu feedback mais recente.",
      reason: feedback.fields.recommended_focus,
      source: "daily_feedback"
    };
  }
  return {
    title: "Use seu vocabulário recente",
    detail: `${newWordsMonth} palavra(s) nova(s) registrada(s) neste mês.`,
    reason: "Converse usando palavras novas em frases mais completas e naturais.",
    source: "vocabulary"
  };
}

function matchesConversationScope(record: TeableRecord<ConversationFields>, userId: string, profileId?: string) {
  return matchesLearningScope(record.fields, { userId, profileId });
}

function matchesRecordScope<T extends { user_id?: string; language_profile_id?: string }>(
  record: TeableRecord<T>,
  userId: string,
  profileId?: string
) {
  return matchesLearningScope(record.fields, { userId, profileId });
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return 0;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

function dateKey(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateNumber(value: string | undefined) {
  if (!value) return 0;
  const valueAsDate = new Date(value).getTime();
  return Number.isNaN(valueAsDate) ? 0 : valueAsDate;
}

function sortByFeedbackDate(a: TeableRecord<DailyFeedbackFields>, b: TeableRecord<DailyFeedbackFields>) {
  return dateNumber(b.fields.date || b.fields.created_at) - dateNumber(a.fields.date || a.fields.created_at);
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return monthKey(date);
}

function levelProgress(level: string | undefined) {
  const values: Record<string, number> = {
    "Iniciante": 20,
    "Intermediário (B1)": 55,
    "Avançado": 82
  };
  return values[level ?? ""] ?? 35;
}

function errorLabel(type: string) {
  const labels: Record<string, string> = {
    grammar: "Gramática",
    vocabulary: "Vocabulário",
    pronunciation: "Pronúncia",
    tense: "Tempos verbais",
    preposition: "Preposições",
    word_order: "Ordem das palavras",
    naturalness: "Naturalidade",
    spelling: "Ortografia"
  };
  return labels[type] ?? type;
}

function shortText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
