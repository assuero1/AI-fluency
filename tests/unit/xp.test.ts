import { describe, expect, it } from "vitest";
import { XP_AMOUNTS, questsToAward } from "@/lib/learning/xp";

describe("questsToAward", () => {
  it("paga só missões recém-concluídas do dia e nunca repete", () => {
    const quests = [
      { key: "finish_conversation", complete: true, xpAward: 10 },
      { key: "learn_words", complete: true, xpAward: 10 },
      { key: "practice_minutes", complete: false, xpAward: 15 }
    ];
    const alreadyPaid = ["finish_conversation:2026-09-03"];
    const award = questsToAward("2026-09-03", quests, alreadyPaid);
    expect(award).toEqual([{ key: "learn_words:2026-09-03", amount: 10 }]);
  });

  it("usa o XP base quando a missão não define prêmio", () => {
    const award = questsToAward("2026-09-03", [{ key: "finish_conversation", complete: true, xpAward: 0 }], []);
    expect(award).toEqual([{ key: "finish_conversation:2026-09-03", amount: XP_AMOUNTS.quest.base }]);
  });
});

describe("XP_AMOUNTS", () => {
  it("conversa vale mais que treino, e nenhum prêmio é zero", () => {
    expect(XP_AMOUNTS.conversation).toBeGreaterThan(XP_AMOUNTS.flashcards);
    expect(XP_AMOUNTS.achievement).toBeGreaterThan(0);
  });
});
