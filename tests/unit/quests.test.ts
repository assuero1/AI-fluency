import { describe, expect, it } from "vitest";
import { buildDailyQuests } from "@/lib/learning/quests";

const base = {
  userId: "u1",
  dayStamp: "2026-09-03",
  conversationsToday: 0,
  flashcardsToday: 0,
  bestFlashcardScoreToday: 0,
  newWordsToday: 0,
  minutesToday: 0,
  queueSessionCardCount: 12
};

describe("buildDailyQuests", () => {
  it("é determinística para o mesmo usuário+dia", () => {
    expect(buildDailyQuests(base)).toEqual(buildDailyQuests(base));
  });

  it("devolve no máximo 3 missões com progresso coerente", () => {
    const quests = buildDailyQuests(base);
    expect(quests.length).toBeLessThanOrEqual(3);
    expect(quests.length).toBeGreaterThan(0);
    for (const quest of quests) {
      expect(quest.progress).toBeLessThanOrEqual(quest.target);
      expect(quest.complete).toBe(quest.progress >= quest.target);
    }
  });

  it("missão de conversa progride com conversas do dia", () => {
    const quests = buildDailyQuests({ ...base, conversationsToday: 1 });
    const conversationQuest = quests.find((quest) => quest.key === "finish_conversation");
    expect(conversationQuest?.complete ?? true).toBe(true);
  });

  it("missão de fila só é elegível quando há fila e completa ao zerá-la", () => {
    const eligible = buildDailyQuests(base);
    expect(eligible.some((quest) => quest.key === "clear_queue")).toBe(true);
    const cleared = buildDailyQuests({ ...base, queueSessionCardCount: 0, flashcardsToday: 1 });
    const clearQuest = cleared.find((quest) => quest.key === "clear_queue");
    expect(clearQuest?.complete ?? false).toBe(true);
  });
});

describe("buildDailyQuests — elegibilidade estável", () => {
  const base = { userId: "u1", dayStamp: "2026-09-03", conversationsToday: 0, flashcardsToday: 0, bestFlashcardScoreToday: 0, newWordsSessionsToday: 0, newWordsToday: 0, minutesToday: 0, queueSessionCardCount: 0 };

  it("o conjunto elegível não depende do estado do dia (sem re-sorteio)", () => {
    const morning = buildDailyQuests(base).map((quest) => quest.key);
    const evening = buildDailyQuests({ ...base, flashcardsToday: 1, bestFlashcardScoreToday: 60 }).map((quest) => quest.key);
    // Praticar durante o dia NÃO pode trocar as missões sorteadas.
    expect(morning).toEqual(evening);
  });
});
