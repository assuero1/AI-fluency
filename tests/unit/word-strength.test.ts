import { describe, expect, it } from "vitest";
import { calculateWordStrength } from "../../lib/learning/words";

const now = new Date("2026-07-10T12:00:00.000Z").getTime();

describe("word strength", () => {
  it("keeps exposure-only vocabulary as new", () => {
    expect(calculateWordStrength({
      correctUses: 0,
      conversationCount: 0,
      lastUsedAt: "2026-07-10T10:00:00.000Z",
      reviewStreak: 0,
      lapseCount: 0,
      lastRating: "",
      correctionCount: 0,
      now
    })).toEqual({ score: 15, level: "new" });
  });

  it("requires repeated correct use across conversations for a strong word", () => {
    const result = calculateWordStrength({
      correctUses: 7,
      conversationCount: 3,
      lastUsedAt: "2026-07-09T10:00:00.000Z",
      reviewStreak: 4,
      lapseCount: 0,
      lastRating: "good",
      correctionCount: 0,
      now
    });

    expect(result.level).toBe("strong");
    expect(result.score).toBeGreaterThanOrEqual(65);
  });

  it("penalizes lapses and recent corrections", () => {
    const stable = calculateWordStrength({ correctUses: 5, conversationCount: 2, lastUsedAt: "2026-07-09", reviewStreak: 2, lapseCount: 0, lastRating: "good", correctionCount: 0, now });
    const unstable = calculateWordStrength({ correctUses: 5, conversationCount: 2, lastUsedAt: "2026-07-09", reviewStreak: 2, lapseCount: 2, lastRating: "forgot", correctionCount: 3, now });

    expect(unstable.score).toBeLessThan(stable.score);
    expect(unstable.level).not.toBe("strong");
  });
});
