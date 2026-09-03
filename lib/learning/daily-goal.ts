// Meta diária única: qualquer modalidade cumpre (conversa, treino ou palavras
// novas). O valor é em minutos de prática concluída no dia local do usuário.
export const DAILY_GOAL_OPTIONS = [5, 15, 30, 60] as const;
export const DEFAULT_DAILY_GOAL_MINUTES = 15;

export function normalizeDailyGoalMinutes(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_DAILY_GOAL_MINUTES;
  const allowed: readonly number[] = DAILY_GOAL_OPTIONS;
  return allowed.includes(number) ? number : DEFAULT_DAILY_GOAL_MINUTES;
}

export type DailyGoalProgress = {
  goalMinutes: number;
  minutesToday: number;
  percent: number;
  complete: boolean;
};

export function computeDailyGoalProgress(input: { goalMinutes: number; conversationSeconds: number; flashcardSeconds: number; newWordsSeconds: number }): DailyGoalProgress {
  // A meta chega validada na escrita (normalizeDailyGoalMinutes); aqui só
  // garantimos um piso positivo para a divisão.
  const goalMinutes = Math.max(1, Math.round(Number(input.goalMinutes) || DEFAULT_DAILY_GOAL_MINUTES));
  const minutesToday = Math.round((input.conversationSeconds + input.flashcardSeconds + input.newWordsSeconds) / 60);
  const percent = Math.min(100, Math.round((minutesToday / goalMinutes) * 100));
  return { goalMinutes, minutesToday, percent, complete: minutesToday >= goalMinutes };
}
