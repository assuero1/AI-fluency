import { getConnectionStatus } from "@/lib/settings/status";
import { getTeableClient, TeableRecord } from "@/lib/supabase/client";
import { getActiveLanguageProfile, getDailyNewCardsQuota, getSessionUser } from "./profile";
import type { ConversationFields } from "./conversations";
import { getPracticeActivity } from "./practice-activity";
import { summarizeDailyQueue, type DailyQueueSessionFields } from "./daily-queue";
import { dateKeyInTimeZone, resolveTimeZone } from "./tz";
import { computeDailyGoalProgress, normalizeDailyGoalMinutes } from "./daily-goal";
import { buildDailyQuests } from "./quests";
import { STREAK_MILESTONES, syncStreakForUser } from "./streak";

export type TopicFields = {
  Name?: string;
  user_id: string;
  language_profile_id: string;
  title: string;
  source: string;
  reason: string;
  related_feedback_id: string;
  related_words: string;
  difficulty: string;
  created_at: string;
};

export type DailyFeedbackFields = {
  user_id: string;
  language_profile_id: string;
  date: string;
  strengths: string;
  weaknesses: string;
  recommended_focus: string;
  recurring_errors: string;
  new_words_count: number;
  correction_score: number;
  fluency_score: number;
  suggested_topics: string;
  created_at: string;
};

export type WordFields = {
  user_id: string;
  language_profile_id: string;
  lemma: string;
  display_text: string;
  translation: string;
  part_of_speech: string;
  familiarity_score: number;
  total_uses: number;
  last_used_at: string;
  first_used_at: string;
  review_due_at: string;
  last_reviewed_at?: string;
  review_state?: string;
  leech_flagged_at?: string;
  lapse_count?: number;
};

export type HomeSuggestion = {
  id?: string;
  title: string;
  meta: string;
  badge: string;
  tone: "primary" | "warning" | "info";
  source: string;
  reason: string;
};

export async function getHomeData() {
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
  const [topics, feedbacks, words, conversations, sessions] = scopeFilters
    ? await Promise.all([
        client.listRecordsWhereAll<TopicFields>("topics", scopeFilters),
        client.listRecordsWhereAll<DailyFeedbackFields>("dailyFeedbacks", scopeFilters),
        client.listRecordsWhereAll<WordFields>("words", scopeFilters),
        client.listRecordsWhereAll<ConversationFields>("conversations", scopeFilters),
        client.listRecordsWhereAll<DailyQueueSessionFields>("practiceSessions", scopeFilters)
      ])
    : [[], [], [], [], []];

  const now = new Date();
  const todayKey = dateKeyInTimeZone(now, timeZone);
  const localDayOf = (record: { fields: { ended_at?: string; started_at?: string } }) =>
    dateKeyInTimeZone(new Date(record.fields.ended_at || record.fields.started_at || ""), timeZone);

  const profileTopics = topics;
  const profileFeedbacks = feedbacks;
  const profileWords = words;
  const recentFeedback = [...profileFeedbacks].sort((a, b) => dateValue(b.fields.date || b.fields.created_at) - dateValue(a.fields.date || a.fields.created_at))[0] ?? null;
  const topWord = [...profileWords].sort((a, b) => dateValue(b.fields.last_used_at) - dateValue(a.fields.last_used_at))[0];
  const weeklyNewWords = profileWords.filter((word) => isWithinDays(word.fields.first_used_at, 7)).length;
  // Fonte única da streak (3 modalidades, persistida) para todas as telas.
  const [practiceStreak, dailyQueue] = await Promise.all([
    syncStreakForUser(user.id, { timeZone }),
    profile
      ? summarizeDailyQueue(profileWords, sessions, { userId: user.id, profileId: profile.id }, { quota: getDailyNewCardsQuota(user), timeZone })
      : Promise.resolve(null)
  ]);
  const practice = getPracticeActivity(
    conversations
      .filter((conversation) => conversation.fields.status === "completed")
      .map((conversation) => conversation.fields.ended_at || conversation.fields.started_at),
    { timeZone }
  );
  const milestoneToCelebrate = STREAK_MILESTONES.find(
    (milestone) => practiceStreak.streak >= milestone && milestone > Number(user.fields.milestone_seen ?? 0)
  ) ?? null;

  // Meta diária: minutos de QUALQUER modalidade concluída hoje (dia local).
  const completedToday = conversations.filter(
    (conversation) => conversation.fields.status === "completed" && localDayOf(conversation) === todayKey
  );
  const sessionsToday: Array<{ fields: { duration_seconds?: number; type?: string } }> = sessions.filter(
    (session) => session.fields.status === "completed" && localDayOf(session) === todayKey
  );
  const secondsOf = (records: Array<{ fields: { duration_seconds?: number } }>) =>
    records.reduce((sum, record) => sum + Math.max(0, Number(record.fields.duration_seconds ?? 0)), 0);
  const todayGoal = computeDailyGoalProgress({
    goalMinutes: normalizeDailyGoalMinutes(user.fields.daily_goal_minutes),
    conversationSeconds: secondsOf(completedToday),
    flashcardSeconds: secondsOf(sessionsToday.filter((session) => session.fields.type !== "new_words")),
    newWordsSeconds: secondsOf(sessionsToday.filter((session) => session.fields.type === "new_words"))
  });
  const weekConversations = conversations.filter(
    (conversation) => conversation.fields.status === "completed" && isWithinDays(conversation.fields.ended_at || conversation.fields.started_at, 7)
  ).length;
  const weekConversationGoal = Math.max(1, Number(profile?.fields.weekly_conversation_goal ?? 7));

  // Missões diárias: avaliadas sobre o MESMO snapshot do dia local.
  const flashcardSessionsToday = sessionsToday.filter((session) => session.fields.type !== "new_words");
  const newWordsToday = sessionsToday
    .filter((session) => session.fields.type === "new_words")
    .reduce((sum, session) => sum + Math.max(0, Number((session as { fields: { selected_word_count?: number } }).fields.selected_word_count ?? 0)), 0);
  const bestFlashcardScoreToday = flashcardSessionsToday.reduce((best, session) => {
    try {
      const focus = JSON.parse((session as { fields: { focus?: string } }).fields.focus || "{}") as { result?: { score?: number } };
      return Math.max(best, Math.round(Number(focus.result?.score ?? 0)));
    } catch {
      return best;
    }
  }, 0);
  const quests = buildDailyQuests({
    userId: user.id,
    dayStamp: todayKey,
    conversationsToday: completedToday.length,
    flashcardsToday: flashcardSessionsToday.length,
    bestFlashcardScoreToday,
    newWordsToday,
    minutesToday: todayGoal.minutesToday,
    queueSessionCardCount: dailyQueue?.sessionCardCount ?? 0
  });

  return {
    user: {
      id: user.id,
      name: user.fields.Name ?? user.fields.name ?? ""
    },
    profile: profile
      ? {
          id: profile.id,
          languageCode: profile.fields.language_code,
          languageName: profile.fields.language_name,
          level: profile.fields.level,
          learningGoal: profile.fields.learning_goal,
          correctionStyle: profile.fields.correction_style,
          calendarMemoryEnabled: Boolean(profile.fields.calendar_memory_enabled),
          weeklyWordGoal: profile.fields.weekly_word_goal
        }
      : null,
    suggestions: buildSuggestions(profileTopics, profile?.fields.calendar_memory_enabled ? recentFeedback : null, profileWords, dailyQueue),
    feedback: {
      hasFeedback: Boolean(recentFeedback),
      correctionScore: Number(recentFeedback?.fields.correction_score ?? 0),
      recurringErrors: parseCount(recentFeedback?.fields.recurring_errors) ?? 0,
      newWords: Number(recentFeedback?.fields.new_words_count ?? 0),
      recentFocus: recentFeedback?.fields.recommended_focus ?? ""
    },
    words: {
      totalUsed: profileWords.reduce((sum, word) => sum + Number(word.fields.total_uses ?? 0), 0),
      weeklyNew: weeklyNewWords,
      mostRecent: topWord
        ? {
            displayText: topWord.fields.display_text || topWord.fields.lemma || "",
            totalUses: Number(topWord.fields.total_uses ?? 0),
            goal: profile?.fields.weekly_word_goal ?? 500
        }
        : null
    },
    practice: {
      streak: practiceStreak.streak,
      practicedToday: practiceStreak.practicedToday,
      activityDays: practice.activityDays,
      milestoneToCelebrate
    },
    today: {
      goalMinutes: todayGoal.goalMinutes,
      minutesToday: todayGoal.minutesToday,
      percent: todayGoal.percent,
      complete: todayGoal.complete,
      weekConversations,
      weekConversationGoal
    },
    quests,
    completedConversations: conversations.filter((conversation) => conversation.fields.status === "completed").length,
    readiness: await getConnectionStatus()
  };
}

export function buildSuggestions(
  topics: TeableRecord<TopicFields>[],
  feedback: TeableRecord<DailyFeedbackFields> | null,
  words: TeableRecord<WordFields>[],
  dailyQueue?: { dueCount: number; newCount: number } | null
) {
  const saved = [...topics].sort((a, b) => dateValue(b.fields.created_at) - dateValue(a.fields.created_at)).map<HomeSuggestion>((topic, index) => ({
    id: topic.id,
    title: topic.fields.title || topic.fields.Name || "Conversa livre",
    meta: topic.fields.reason || "Tema salvo para sua prática.",
    badge: sourceLabel(topic.fields.source),
    tone: index === 1 ? "warning" : index === 2 ? "info" : "primary",
    source: topic.fields.source || "ai_suggestion",
    reason: topic.fields.reason || ""
  }));
  const feedbackSuggestions = feedback
    ? parseSuggestedTopics(feedback.fields.suggested_topics).map<HomeSuggestion>((item) => ({
        title: item.title,
        meta: item.reason,
        badge: "Calendário",
        tone: "primary",
        source: "calendar_based",
        reason: item.reason
      }))
    : [];
  const dueWords = words
    .filter((word) => Boolean(word.fields.review_due_at) && dateValue(word.fields.review_due_at) <= Date.now())
    .sort((a, b) => dateValue(a.fields.review_due_at) - dateValue(b.fields.review_due_at))
    .slice(0, 3)
    .map((word) => word.fields.display_text || word.fields.lemma)
    .filter(Boolean);
  const wordSuggestion: HomeSuggestion[] = dueWords.length
    ? [{
        title: `Revisar: ${dueWords.join(", ")}`,
        meta: dailyQueue && dailyQueue.dueCount + dailyQueue.newCount > 0
          ? `Hoje: ${dailyQueue.dueCount} revisões + ${dailyQueue.newCount} novas na sua fila.`
          : "Palavras com revisão pendente no seu vocabulário.",
        badge: "Palavras fracas",
        tone: "warning",
        source: "weak_words",
        reason: `Use em contexto estas palavras: ${dueWords.join(", ")}.`
      }]
    : [];

  return uniqueSuggestions([...feedbackSuggestions, ...wordSuggestion, ...saved]).slice(0, 3);
}

function isWithinDays(value: string | undefined, days: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function parseCount(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return value.trim() ? 1 : null;
  }
}

function parseSuggestedTopics(value: string | undefined) {
  if (!value) return [] as Array<{ title: string; reason: string }>;
  try {
    const parsed = JSON.parse(value) as Array<{ title?: string; reason?: string }>;
    return Array.isArray(parsed)
      ? parsed.filter((item) => item.title?.trim()).map((item) => ({ title: item.title!.trim(), reason: item.reason?.trim() || "Sugestão do feedback diário." }))
      : [];
  } catch {
    return [];
  }
}

function sourceLabel(source: string | undefined) {
  const labels: Record<string, string> = {
    calendar_based: "Calendário",
    weak_words: "Palavras fracas",
    recurring_error: "Erro recorrente",
    user_custom: "Seu tema",
    ai_suggestion: "IA"
  };
  return labels[source ?? ""] ?? "Sugestão";
}

function uniqueSuggestions(suggestions: HomeSuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.title.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateValue(value: string | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
