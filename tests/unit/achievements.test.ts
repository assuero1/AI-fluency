import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, type AchievementSnapshot } from "@/lib/learning/achievements";

const empty: AchievementSnapshot = {
  conversationsCompleted: 0,
  flashcardSessionsCompleted: 0,
  bestFlashcardScore: 0,
  wordsSaved: 0,
  wordsConsolidated: 0,
  currentStreak: 0,
  newWordsLearned: 0,
  sensesAdded: 0,
  startedSimulation: false,
  usedFocusPractice: false,
  daysSinceLastPractice: 0
};

describe("ACHIEVEMENTS", () => {
  it("chaves únicas e descrição em toda conquista", () => {
    const keys = ACHIEVEMENTS.map((achievement) => achievement.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.title.length).toBeGreaterThan(0);
      expect(achievement.description.length).toBeGreaterThan(0);
    }
  });

  it("desbloqueia primeira conversa só quando existe", () => {
    const first = ACHIEVEMENTS.find((achievement) => achievement.key === "first_conversation")!;
    expect(first.check(empty)).toBe(false);
    expect(first.check({ ...empty, conversationsCompleted: 1 })).toBe(true);
  });

  it("marcos de streak e vocabulário avaliam pelo snapshot", () => {
    const streak7 = ACHIEVEMENTS.find((achievement) => achievement.key === "streak_7")!;
    const words200 = ACHIEVEMENTS.find((achievement) => achievement.key === "words_200")!;
    expect(streak7.check({ ...empty, currentStreak: 6 })).toBe(false);
    expect(streak7.check({ ...empty, currentStreak: 7 })).toBe(true);
    expect(words200.check({ ...empty, wordsSaved: 200 })).toBe(true);
  });
});
