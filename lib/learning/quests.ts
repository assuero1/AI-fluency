// Missões diárias: 3 por dia, determinísticas por usuário+data (mesma técnica
// de hash do interleave da fila do SRS), avaliadas a partir de dados que o app
// já grava — sem novo rastreamento. `xpAward` é pago pelo Plano 3 (lib/xp).
import { hashSeed } from "./spaced-repetition";

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

const CATALOG: QuestDefinition[] = [
  { key: "finish_conversation", title: "Finalize 1 conversa", target: 1, xpAward: 10, eligible: () => true, progress: (input) => input.conversationsToday },
  { key: "finish_training", title: "Conclua 1 treino de cards", target: 1, xpAward: 10, eligible: (input) => input.queueSessionCardCount > 0 || input.flashcardsToday > 0, progress: (input) => input.flashcardsToday },
  { key: "sharp_training", title: "Tire 80%+ num treino", target: 80, xpAward: 15, eligible: () => true, progress: (input) => input.bestFlashcardScoreToday },
  { key: "learn_words", title: "Aprenda 3 palavras novas", target: 3, xpAward: 10, eligible: () => true, progress: (input) => input.newWordsToday },
  { key: "practice_minutes", title: "Pratique 15 minutos", target: 15, xpAward: 15, eligible: () => true, progress: (input) => Math.min(input.minutesToday, 15) },
  { key: "clear_queue", title: "Zere a fila de revisão de hoje", target: 1, xpAward: 15, eligible: (input) => input.queueSessionCardCount > 0 || input.flashcardsToday > 0, progress: (input) => (input.queueSessionCardCount === 0 && input.flashcardsToday > 0 ? 1 : 0) }
];

const QUESTS_PER_DAY = 3;

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
