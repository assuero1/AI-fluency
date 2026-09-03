// Missões diárias: 3 por dia, determinísticas por usuário+data (mesma técnica
// de hash do interleave da fila do SRS), avaliadas a partir de dados que o app
// já grava — sem novo rastreamento. `xpAward` é pago por lib/learning/xp.ts.
import { getTeableClient, type TeableRecord } from "@/lib/supabase/client";
import { hashSeed } from "./spaced-repetition";
import { summarizeDailyQueue, type DailyQueueSessionFields, type DailyQueueWordFields } from "./daily-queue";
import { dateKeyInTimeZone } from "./tz";

export type Quest = {
  key: string;
  title: string;
  target: number;
  progress: number;
  complete: boolean;
  xpAward: number;
};

export type DailyQuestInputs = {
  userId: string;
  dayStamp: string;
  conversationsToday: number;
  flashcardsToday: number;
  bestFlashcardScoreToday: number;
  newWordsToday: number;
  minutesToday: number;
  queueSessionCardCount: number;
};

type QuestDefinition = {
  key: string;
  title: string;
  target: number;
  xpAward: number;
  eligible: (input: DailyQuestInputs) => boolean;
  progress: (input: DailyQuestInputs) => number;
};

// Elegibilidade é CONSTANTE por dia: dependências de estado mutável do dia
// faziam o top-3 sortear de novo no meio do dia (missão em progresso sumia).
const CATALOG: QuestDefinition[] = [
  { key: "finish_conversation", title: "Finalize 1 conversa", target: 1, xpAward: 10, eligible: () => true, progress: (input) => input.conversationsToday },
  { key: "finish_training", title: "Conclua 1 treino de cards", target: 1, xpAward: 10, eligible: () => true, progress: (input) => input.flashcardsToday },
  { key: "sharp_training", title: "Tire 80%+ num treino", target: 80, xpAward: 15, eligible: () => true, progress: (input) => input.bestFlashcardScoreToday },
  { key: "learn_words", title: "Aprenda 3 palavras novas", target: 3, xpAward: 10, eligible: () => true, progress: (input) => input.newWordsToday },
  { key: "practice_minutes", title: "Pratique 15 minutos", target: 15, xpAward: 15, eligible: () => true, progress: (input) => Math.min(input.minutesToday, 15) },
  { key: "clear_queue", title: "Zere a fila de revisão de hoje", target: 1, xpAward: 15, eligible: () => true, progress: (input) => (input.queueSessionCardCount === 0 && input.flashcardsToday > 0 ? 1 : 0) }
];

const QUESTS_PER_DAY = 3;

// Snapshot do dia local de um aluno, a partir dos registros já carregados
// (conversas + practice_sessions). Usado pela Home e pelos hooks de XP.
export type DayPracticeSummary = {
  todayKey: string;
  conversationsToday: number;
  conversationSecondsToday: number;
  flashcardSecondsToday: number;
  newWordsSecondsToday: number;
  flashcardSessionsToday: number;
  newWordsToday: number;
  bestFlashcardScoreToday: number;
  minutesToday: number;
  queueSessionCardCount: number;
};

type DayConversationFields = { status?: string; ended_at?: string; started_at?: string; duration_seconds?: number };
type DaySessionFields = { status?: string; type?: string; ended_at?: string; started_at?: string; duration_seconds?: number; selected_word_count?: number; focus?: string };

export function summarizeDayPractice(input: {
  userId: string;
  profileId: string;
  timeZone: string;
  quota: number;
  conversations: Array<TeableRecord<DayConversationFields>>;
  sessions: Array<TeableRecord<DaySessionFields>>;
  words: Array<TeableRecord<DailyQueueWordFields>>;
  now?: Date;
}): DayPracticeSummary {
  const now = input.now ?? new Date();
  const todayKey = dateKeyInTimeZone(now, input.timeZone);
  const localDayOf = (record: { fields: { ended_at?: string; started_at?: string } }) =>
    dateKeyInTimeZone(new Date(record.fields.ended_at || record.fields.started_at || ""), input.timeZone);

  const completedToday = input.conversations.filter(
    (conversation) => conversation.fields.status === "completed" && localDayOf(conversation) === todayKey
  );
  const sessionsToday = input.sessions.filter(
    (session) => session.fields.status === "completed" && localDayOf(session) === todayKey
  );
  const flashcardSessionsToday = sessionsToday.filter((session) => session.fields.type !== "new_words");
  const secondsOf = (records: Array<{ fields: { duration_seconds?: number } }>) =>
    records.reduce((sum, record) => sum + Math.max(0, Number(record.fields.duration_seconds ?? 0)), 0);
  const conversationSecondsToday = secondsOf(completedToday);
  const flashcardSecondsToday = secondsOf(flashcardSessionsToday);
  const newWordsSecondsToday = secondsOf(sessionsToday.filter((session) => session.fields.type === "new_words"));
  const bestFlashcardScoreToday = flashcardSessionsToday.reduce((best, session) => {
    try {
      const focus = JSON.parse(session.fields.focus || "{}") as { result?: { score?: number } };
      return Math.max(best, Math.round(Number(focus.result?.score ?? 0)));
    } catch {
      return best;
    }
  }, 0);
  const newWordsToday = sessionsToday
    .filter((session) => session.fields.type === "new_words")
    .reduce((sum, session) => sum + Math.max(0, Number(session.fields.selected_word_count ?? 0)), 0);
  const minutesToday = Math.round((conversationSecondsToday + flashcardSecondsToday + newWordsSecondsToday) / 60);
  const queue = summarizeDailyQueue(input.words, input.sessions as Array<TeableRecord<DailyQueueSessionFields>>, { userId: input.userId, profileId: input.profileId }, { quota: input.quota, timeZone: input.timeZone });

  return {
    todayKey,
    conversationsToday: completedToday.length,
    conversationSecondsToday,
    flashcardSecondsToday,
    newWordsSecondsToday,
    flashcardSessionsToday: flashcardSessionsToday.length,
    newWordsToday,
    bestFlashcardScoreToday,
    minutesToday,
    queueSessionCardCount: queue.sessionCardCount
  };
}

export function toQuestInputs(summary: DayPracticeSummary, userId: string): DailyQuestInputs {
  return {
    userId,
    dayStamp: summary.todayKey,
    conversationsToday: summary.conversationsToday,
    flashcardsToday: summary.flashcardSessionsToday,
    bestFlashcardScoreToday: summary.bestFlashcardScoreToday,
    newWordsToday: summary.newWordsToday,
    minutesToday: summary.minutesToday,
    queueSessionCardCount: summary.queueSessionCardCount
  };
}

// Para os hooks de XP (conversa/treino/palavras novas): busca o próprio
// snapshot do dia. Best-effort nos chamadores.
export async function collectQuestInputs(userId: string, profileId: string, timeZone: string, quota: number, now: Date = new Date()): Promise<DailyQuestInputs> {
  const client = getTeableClient();
  const scopeFilters = [
    { field: "user_id", value: userId },
    { field: "language_profile_id", value: profileId }
  ];
  const [conversations, sessions, words] = await Promise.all([
    client.listRecordsWhereAll<DayConversationFields>("conversations", scopeFilters),
    client.listRecordsWhereAll<DaySessionFields>("practiceSessions", scopeFilters),
    client.listRecordsWhereAll<DailyQueueWordFields>("words", scopeFilters)
  ]);
  const summary = summarizeDayPractice({
    userId,
    profileId,
    timeZone,
    quota,
    conversations,
    sessions,
    words,
    now
  });
  return toQuestInputs(summary, userId);
}

export function buildDailyQuests(input: DailyQuestInputs): Quest[] {
  return CATALOG
    .filter((definition) => definition.eligible(input))
    .map((definition) => ({ definition, sort: hashSeed(`${input.userId}:${input.dayStamp}:${definition.key}`) }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, QUESTS_PER_DAY)
    .map(({ definition }) => {
      const progress = Math.min(definition.progress(input), definition.target);
      return {
        key: definition.key,
        title: definition.title,
        target: definition.target,
        progress,
        complete: progress >= definition.target,
        xpAward: definition.xpAward
      };
    });
}
