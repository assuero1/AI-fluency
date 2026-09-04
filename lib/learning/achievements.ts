// Conquistas: catálogo fixo avaliado sobre um snapshot do aluno. A avaliação
// roda nos 3 hooks de conclusão (conversa, treino, palavras novas); desbloqueios
// são persistidos em engagement_achievements (índice único por user+key) e
// devolvidos na resposta para o toast do cliente.
import { getTeableClient, type TeableRecord } from "@/lib/supabase/client";
import { dateKeyInTimeZone, dayKeyFromDateColumn, resolveTimeZone } from "./tz";
import { awardXp, XP_AMOUNTS } from "./xp";

export type AchievementSnapshot = {
  conversationsCompleted: number;
  flashcardSessionsCompleted: number;
  bestFlashcardScore: number;
  wordsSaved: number;
  wordsConsolidated: number;
  currentStreak: number;
  newWordsLearned: number;
  sensesAdded: number;
  startedSimulation: boolean;
  usedFocusPractice: boolean;
  daysSinceLastPractice: number;
};

export type AchievementProgress = { current: number; target: number };

export type AchievementDefinition = {
  key: string;
  title: string;
  description: string;
  check: (snapshot: AchievementSnapshot) => boolean;
  /** Progresso contínuo para o anel da tela de conquistas (só nas numéricas). */
  progress?: (snapshot: AchievementSnapshot) => AchievementProgress;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { key: "first_conversation", title: "Primeira conversa", description: "Você concluiu sua primeira conversa com a IA.", check: (s) => s.conversationsCompleted >= 1, progress: (s) => ({ current: s.conversationsCompleted, target: 1 }) },
  { key: "conversations_10", title: "Dez conversas", description: "10 conversas concluídas. O hábito está pegando.", check: (s) => s.conversationsCompleted >= 10, progress: (s) => ({ current: s.conversationsCompleted, target: 10 }) },
  { key: "conversations_50", title: "Cinquenta conversas", description: "50 conversas concluídas. Isso é compromisso.", check: (s) => s.conversationsCompleted >= 50, progress: (s) => ({ current: s.conversationsCompleted, target: 50 }) },
  { key: "words_25", title: "25 palavras salvas", description: "Seu vocabulário real já tem 25 palavras.", check: (s) => s.wordsSaved >= 25, progress: (s) => ({ current: s.wordsSaved, target: 25 }) },
  { key: "words_200", title: "200 palavras salvas", description: "200 palavras do seu uso real salvas.", check: (s) => s.wordsSaved >= 200, progress: (s) => ({ current: s.wordsSaved, target: 200 }) },
  { key: "consolidated_50", title: "50 consolidadas", description: "50 palavras já estão na memória de longo prazo.", check: (s) => s.wordsConsolidated >= 50, progress: (s) => ({ current: s.wordsConsolidated, target: 50 }) },
  { key: "streak_3", title: "3 dias seguidos", description: "Três dias de prática consecutivos.", check: (s) => s.currentStreak >= 3, progress: (s) => ({ current: s.currentStreak, target: 3 }) },
  { key: "streak_7", title: "Uma semana inteira", description: "7 dias seguidos de prática.", check: (s) => s.currentStreak >= 7, progress: (s) => ({ current: s.currentStreak, target: 7 }) },
  { key: "streak_30", title: "Um mês de constância", description: "30 dias seguidos. Disciplina de quem veio para ficar.", check: (s) => s.currentStreak >= 30, progress: (s) => ({ current: s.currentStreak, target: 30 }) },
  { key: "training_score_90", title: "Treino impecável", description: "90% de acerto ou mais em um treino de cards.", check: (s) => s.bestFlashcardScore >= 90, progress: (s) => ({ current: s.bestFlashcardScore, target: 90 }) },
  { key: "new_words_25", title: "25 palavras aprendidas", description: "25 palavras dominadas nas sessões de palavras novas.", check: (s) => s.newWordsLearned >= 25, progress: (s) => ({ current: s.newWordsLearned, target: 25 }) },
  { key: "senses_5", title: "Cinco novos sentidos", description: "Você registrou 5 significados novos para palavras que já conhecia.", check: (s) => s.sensesAdded >= 5, progress: (s) => ({ current: s.sensesAdded, target: 5 }) },
  { key: "simulation_first", title: "Primeira simulação", description: "Você enfrentou sua primeira simulação de situação real.", check: (s) => s.startedSimulation },
  { key: "focus_practice", title: "No alvo", description: "Praticou um foco recomendado pela IA.", check: (s) => s.usedFocusPractice },
  { key: "comeback", title: "De volta ao jogo", description: "Voltou a praticar depois de uma pausa.", check: (s) => s.conversationsCompleted >= 1 && s.daysSinceLastPractice >= 7 }
];

export type AchievementUnlock = { key: string; title: string; description: string };

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function parseSessionScore(focus: string | undefined) {
  try {
    const parsed = JSON.parse(focus || "{}") as { result?: { score?: number } };
    return Math.round(Number(parsed.result?.score ?? 0));
  } catch {
    return 0;
  }
}

// Contadores que os hooks normalmente já têm em mãos podem vir em `partial`
// para evitar re-consulta; o resto é coletado aqui.
// Coleta os contadores do zero (queries). Separada de evaluateAchievements
// para a tela de conquistas reaproveitar o snapshot sem reavaliar desbloqueios.
async function collectAchievementSnapshot(userId: string): Promise<AchievementSnapshot> {
  const client = getTeableClient();
  const [userRecords, conversations, sessions, words, events] = await Promise.all([
    client.listRecordsWhereAll<{ current_streak?: number; last_practice_day?: string | null; timezone?: string }>("users", [{ field: "id", value: userId }]),
    client.listRecordsWhereAll<{ status?: string; interaction_mode?: string; ended_at?: string; started_at?: string }>("conversations", [{ field: "user_id", value: userId }]),
    client.listRecordsWhereAll<{ status?: string; type?: string; selected_word_count?: number; focus?: string }>("practiceSessions", [{ field: "user_id", value: userId }]),
    client.listRecordsWhereAll<{ review_state?: string }>("words", [{ field: "user_id", value: userId }]),
    client.listRecordsWhereAll<{ event_name?: string; payload?: { sense_created?: boolean } | string }>("appEvents", [{ field: "user_id", value: userId }])
  ]);

  const user = userRecords[0];
  const timeZone = resolveTimeZone(user?.fields.timezone);
  const completedConversations = conversations.filter((record) => record.fields.status === "completed");
  const completedFlashcards = sessions.filter((record) => record.fields.status === "completed" && record.fields.type === "flashcards");
  const lastPracticeDay = user?.fields.last_practice_day ? dayKeyFromDateColumn(user.fields.last_practice_day, timeZone) || null : null;
  const today = dateKeyInTimeZone(new Date(), timeZone);
  const daysSinceLastPractice = lastPracticeDay
    ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastPracticeDay}T12:00:00Z`)) / 86_400_000))
    : 0;

  return {
    conversationsCompleted: completedConversations.length,
    flashcardSessionsCompleted: completedFlashcards.length,
    bestFlashcardScore: completedFlashcards.reduce((best, record) => Math.max(best, parseSessionScore(record.fields.focus)), 0),
    wordsSaved: words.filter((record) => Boolean(record.fields.review_state)).length,
    wordsConsolidated: words.filter((record) => record.fields.review_state === "review").length,
    currentStreak: Number(user?.fields.current_streak ?? 0),
    newWordsLearned: sessions
      .filter((record) => record.fields.status === "completed" && record.fields.type === "new_words")
      .reduce((sum, record) => sum + Math.max(0, Number(record.fields.selected_word_count ?? 0)), 0),
    sensesAdded: events.filter((record) => {
      if (record.fields.event_name !== "new_words_attempt_judged") return false;
      const payload = record.fields.payload;
      const senseCreated = typeof payload === "string" ? (safeJsonParse(payload) as { sense_created?: boolean } | null)?.sense_created : payload?.sense_created;
      return senseCreated === true;
    }).length,
    startedSimulation: conversations.some((record) => record.fields.interaction_mode === "simulation"),
    usedFocusPractice: events.some((record) => record.fields.event_name === "progress_focus_practice_started" || record.fields.event_name === "calendar_feedback_practice_started"),
    daysSinceLastPractice
  };
}

export async function evaluateAchievements(
  userId: string,
  partial: Partial<AchievementSnapshot> = {},
  additive: Partial<AchievementSnapshot> = {}
): Promise<AchievementUnlock[]> {
  const client = getTeableClient();
  const base = await collectAchievementSnapshot(userId);
  // `partial` substitui (campos que o hook conhece melhor que a query);
  // `additive` SOMA sobre a base (totais vitalícios que a sessão corrente
  // ainda não persistiu — ex.: palavras da sessão em curso).
  const snapshot = {
    ...base,
    ...partial,
    ...Object.fromEntries(
      Object.entries(additive).map(([key, value]) => [
        key,
        typeof value === "number" ? Number((base as Record<string, unknown>)[key] ?? 0) + value : value
      ])
    )
  } as AchievementSnapshot;

  const owned = new Set(
    (await client.listRecordsWhereAll<{ achievement_key?: string }>("engagementAchievements", [{ field: "user_id", value: userId }]))
      .map((record) => String(record.fields.achievement_key ?? ""))
  );
  const unlocked: AchievementUnlock[] = [];
  for (const definition of ACHIEVEMENTS) {
    if (owned.has(definition.key) || !definition.check(snapshot)) continue;
    unlocked.push({ key: definition.key, title: definition.title, description: definition.description });
    try {
      await client.createRecord("engagementAchievements", { user_id: userId, achievement_key: definition.key });
      await client.createEvent(userId, "achievement_unlocked", { achievement_key: definition.key });
      await awardXp(userId, XP_AMOUNTS.achievement, `achievement:${definition.key}`);
    } catch {
      // Corrida inofensiva: o índice único recusa duplicado.
    }
  }
  return unlocked;
}

export type AchievementSummaryRow = {
  key: string;
  title: string;
  description: string;
  unlockedAt: string | null;
  progress: AchievementProgress | null;
};

export async function getAchievementsSummary(userId: string): Promise<AchievementSummaryRow[]> {
  const client = getTeableClient();
  const [owned, snapshot] = await Promise.all([
    client.listRecordsWhereAll<{ achievement_key?: string; unlocked_at?: string }>("engagementAchievements", [{ field: "user_id", value: userId }]),
    collectAchievementSnapshot(userId)
  ]);
  const ownedByKey = new Map(owned.map((record) => [String(record.fields.achievement_key ?? ""), record.fields.unlocked_at ?? new Date().toISOString()]));
  return ACHIEVEMENTS.map((definition) => ({
    key: definition.key,
    title: definition.title,
    description: definition.description,
    unlockedAt: ownedByKey.get(definition.key) ?? null,
    progress: definition.progress?.(snapshot) ?? null
  }));
}

// Reexportado para os hooks tiparem os próprios campos sem importar o tipo
// bruto do adapter.
export type AchievementRecord = TeableRecord<{ achievement_key?: string }>;
