import { describe, expect, it } from "vitest";
import { computeDailyGoalProgress, normalizeDailyGoalMinutes } from "@/lib/learning/daily-goal";

describe("computeDailyGoalProgress", () => {
  it("soma as três modalidades em minutos", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 15, conversationSeconds: 420, flashcardSeconds: 240, newWordsSeconds: 120 });
    expect(progress.minutesToday).toBe(13);
    expect(progress.percent).toBe(87);
    expect(progress.complete).toBe(false);
  });

  it("completa quando atinge a meta", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 10, conversationSeconds: 620, flashcardSeconds: 0, newWordsSeconds: 0 });
    expect(progress.complete).toBe(true);
    expect(progress.percent).toBe(100);
  });

  it("nunca passa de 100%", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 5, conversationSeconds: 3600, flashcardSeconds: 3600, newWordsSeconds: 3600 });
    expect(progress.percent).toBe(100);
    expect(progress.minutesToday).toBeGreaterThan(5);
  });
});

describe("normalizeDailyGoalMinutes", () => {
  it("aceita apenas os valores oferecidos no app", () => {
    expect(normalizeDailyGoalMinutes(5)).toBe(5);
    expect(normalizeDailyGoalMinutes(30)).toBe(30);
    expect(normalizeDailyGoalMinutes(17)).toBe(15);
    expect(normalizeDailyGoalMinutes("abc")).toBe(15);
    expect(normalizeDailyGoalMinutes(undefined)).toBe(15);
  });
});
