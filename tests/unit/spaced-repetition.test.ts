import { describe, expect, it } from "vitest";
import { calculateAdaptiveReview, previewSingleInterval, REVIEW_VERSION } from "../../lib/learning/spaced-repetition";

const now = new Date("2026-07-10T12:00:00.000Z");

describe("adaptive spaced repetition v2", () => {
  it("starts a brand-new word in learning with a one-day step", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "good", responseTimeMs: 3_000, cardType: "target_to_native" }], now);
    expect(review).toMatchObject({
      reviewIntervalDays: 1, learningStep: 1, reviewStreak: 1, reviewEase: 2.3,
      lapseCount: 0, familiarityScore: 1, reviewState: "learning",
      lastRating: "good", reviewVersion: REVIEW_VERSION
    });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("advances through the learning steps and graduates to a seven-day interval", () => {
    const step1 = calculateAdaptiveReview({}, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(step1).toMatchObject({ learningStep: 1, reviewStreak: 1, reviewState: "learning" });
    expect(step1.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
    const step2 = calculateAdaptiveReview({ learning_step: 1, review_streak: 1, review_ease: 2.3 }, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(step2).toMatchObject({ learningStep: 2, reviewStreak: 2, reviewState: "learning" });
    expect(step2.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
    const graduated = calculateAdaptiveReview({ learning_step: 2, review_streak: 2, review_ease: 2.3 }, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(graduated).toMatchObject({ reviewIntervalDays: 7, learningStep: 3, reviewStreak: 3, reviewState: "review" });
    expect(graduated.reviewDueAt).toBe("2026-07-17T09:00:00.000Z");
  });

  it("fast-tracks learning on easy and graduates with a fifteen-day interval", () => {
    const fastTracked = calculateAdaptiveReview({}, [{ rating: "easy", responseTimeMs: 1_000 }], now);
    expect(fastTracked).toMatchObject({ learningStep: 2, reviewEase: 2.4, reviewStreak: 1, reviewState: "learning" });
    expect(fastTracked.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
    const graduated = calculateAdaptiveReview({ learning_step: 1, review_streak: 1, review_ease: 2.3 }, [{ rating: "easy", responseTimeMs: 1_000 }], now);
    expect(graduated).toMatchObject({ reviewIntervalDays: 15, learningStep: 3, reviewEase: 2.4, reviewState: "review" });
  });

  it("keeps the graduated growth formula for mastered words", () => {
    const mastered = calculateAdaptiveReview(
      { review_streak: 4, review_interval_days: 60, review_ease: 2.5, review_state: "review" },
      [{ rating: "easy", responseTimeMs: 1_000 }], now
    );
    expect(mastered).toMatchObject({ reviewIntervalDays: 231, reviewEase: 2.6, reviewStreak: 5, reviewState: "review" });
  });

  it("sends a graduated lapse into relearning, keeping the pre-lapse interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 2.6, review_streak: 5, lapse_count: 1, last_rating: "forgot", familiarity_score: 8, review_state: "review" },
      [{ rating: "forgot", responseTimeMs: 2_000 }], now
    );
    expect(review).toMatchObject({
      reviewIntervalDays: 30, learningStep: 0, reviewStreak: 0, lapseCount: 2,
      reviewEase: 2.35, familiarityScore: 6, reviewState: "difficult"
    });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("regraduates from relearning with half the pre-lapse interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 2.35, review_streak: 0, lapse_count: 2, learning_step: 0, last_rating: "forgot", review_state: "difficult" },
      [{ rating: "good", responseTimeMs: 3_000 }, { rating: "good", responseTimeMs: 3_000 }, { rating: "good", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 15, learningStep: 3, reviewStreak: 3, reviewState: "review" });
  });

  it("regraduates from relearning with three quarters of the pre-lapse interval on easy", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 20, review_ease: 2.3, review_streak: 0, lapse_count: 1, learning_step: 1, last_rating: "forgot", review_state: "difficult" },
      [{ rating: "easy", responseTimeMs: 1_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 15, learningStep: 3, reviewEase: 2.4, reviewState: "review" });
  });

  it("floors the regraduated interval at four days", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 6, review_ease: 2.3, review_streak: 0, lapse_count: 1, learning_step: 2, last_rating: "forgot", review_state: "difficult" },
      [{ rating: "good", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 4, learningStep: 3, reviewState: "review" });
  });

  it("applies multiple attempts sequentially, crediting in-session recovery", () => {
    const recovered = calculateAdaptiveReview(
      { review_interval_days: 30, review_streak: 5, lapse_count: 0, review_state: "review" },
      [{ rating: "forgot" }, { rating: "good" }, { rating: "good" }], now
    );
    expect(recovered).toMatchObject({ reviewIntervalDays: 30, learningStep: 2, lapseCount: 1, reviewStreak: 2, reviewState: "learning" });
    expect(recovered.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
  });

  it("keeps graduated hard reviews between one and four days", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 1.3, review_streak: 3, review_state: "review" },
      [{ rating: "hard", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 4, reviewEase: 1.3, reviewStreak: 2, reviewState: "review" });
  });

  it("repeats the current learning step on hard without graduating", () => {
    const review = calculateAdaptiveReview(
      { learning_step: 1, review_streak: 1, review_ease: 2.3 },
      [{ rating: "hard", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ learningStep: 1, reviewStreak: 0, reviewEase: 2.22, reviewState: "learning" });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("flags a leech once at the lapse threshold and preserves the timestamp", () => {
    const flagged = calculateAdaptiveReview(
      { review_interval_days: 15, review_ease: 2.3, review_streak: 1, lapse_count: 3, review_state: "review" },
      [{ rating: "forgot" }], now
    );
    expect(flagged).toMatchObject({ lapseCount: 4, reviewState: "difficult", leechFlaggedAt: "2026-07-10T12:00:00.000Z" });
    const again = calculateAdaptiveReview(
      { review_interval_days: 15, lapse_count: 4, learning_step: 0, last_rating: "forgot", leech_flagged_at: "2026-07-01T09:00:00.000Z", review_state: "difficult" },
      [{ rating: "forgot" }], now
    );
    expect(again.leechFlaggedAt).toBe("2026-07-01T09:00:00.000Z");
  });

  it("applies a deterministic interval fuzz only with a seed on long graduated intervals", () => {
    const current = { review_interval_days: 60, review_streak: 4, review_ease: 2.5, review_state: "review" as const };
    const attempt = [{ rating: "good" as const, responseTimeMs: 3_000 }];
    const withoutSeed = calculateAdaptiveReview(current, attempt, now);
    const seededA = calculateAdaptiveReview(current, attempt, now, "UTC", "word-a");
    const seededB = calculateAdaptiveReview(current, attempt, now, "UTC", "word-a");
    expect(withoutSeed.reviewIntervalDays).toBe(150);
    expect(seededA.reviewIntervalDays).toBe(seededB.reviewIntervalDays);
    expect(seededA.reviewIntervalDays).toBeGreaterThanOrEqual(135);
    expect(seededA.reviewIntervalDays).toBeLessThanOrEqual(165);
  });

  it("keeps due dates on the learner calendar across a timezone offset", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "forgot" }], new Date("2026-07-10T02:30:00.000Z"), "America/Sao_Paulo");
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(review.reviewDueAt));
    expect(localDate).toBe("2026-07-10");
  });

  it("normalizes incomplete legacy data and caps the largest interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 9_999, review_ease: 99, review_streak: -2, lapse_count: -1, review_state: "review" },
      [{ rating: "easy" }], now, "not/a-timezone"
    );
    expect(review).toMatchObject({ reviewIntervalDays: 365, reviewEase: 2.8, reviewStreak: 1, lapseCount: 0, reviewVersion: REVIEW_VERSION });
  });

  it("preserves a suspended word while recording the review fields", () => {
    const review = calculateAdaptiveReview({ review_state: "suspended" }, [{ rating: "good" }], now);
    expect(review.reviewState).toBe("suspended");
  });

  it("requires at least one attempt", () => {
    expect(() => calculateAdaptiveReview({}, [], now)).toThrow("At least one review attempt is required.");
  });
});

describe("previewSingleInterval", () => {
  const NOW = new Date("2026-08-02T12:00:00.000Z");

  it("previews a new word's learning steps without fuzz", () => {
    // good avança 1 passo (1d); easy avança 2 passos (3d) — graduação exige passar do último passo.
    const current = { review_state: "new" as const };
    expect(previewSingleInterval(current, { rating: "forgot", responseTimeMs: 0, cardType: "target_to_native" }, NOW, "UTC", "w1")).toBe(1);
    expect(previewSingleInterval(current, { rating: "hard", responseTimeMs: 0, cardType: "target_to_native" }, NOW, "UTC", "w1")).toBe(1);
    expect(previewSingleInterval(current, { rating: "good", responseTimeMs: 0, cardType: "target_to_native" }, NOW, "UTC", "w1")).toBe(1);
    expect(previewSingleInterval(current, { rating: "easy", responseTimeMs: 0, cardType: "target_to_native" }, NOW, "UTC", "w1")).toBe(3);
  });

  it("previews a graduated word with the fuzzed interval bounded", () => {
    const current = { review_state: "review" as const, review_interval_days: 3, review_streak: 1, review_ease: 2.3, learning_step: 3 };
    const forgot = previewSingleInterval(current, { rating: "forgot", responseTimeMs: 0, cardType: "cloze" }, NOW, "UTC", "w2");
    const hard = previewSingleInterval(current, { rating: "hard", responseTimeMs: 0, cardType: "cloze" }, NOW, "UTC", "w2");
    const good = previewSingleInterval(current, { rating: "good", responseTimeMs: 0, cardType: "cloze" }, NOW, "UTC", "w2");
    const easy = previewSingleInterval(current, { rating: "easy", responseTimeMs: 0, cardType: "cloze" }, NOW, "UTC", "w2");
    expect(forgot).toBe(1);
    expect(hard).toBeGreaterThanOrEqual(1);
    expect(good).toBeGreaterThanOrEqual(6);
    expect(good).toBeLessThanOrEqual(8);
    expect(easy).toBeGreaterThan(good);
  });

  it("matches the grade path's schedule for the same attempt", () => {
    const current = { review_state: "review" as const, review_interval_days: 10, review_streak: 2, review_ease: 2.4, learning_step: 3 };
    for (const rating of ["forgot", "hard", "good", "easy"] as const) {
      const attempt = { rating, responseTimeMs: 0, cardType: "listening" as const };
      const grade = calculateAdaptiveReview(current, [attempt], NOW, "UTC", "w4");
      expect(previewSingleInterval(current, attempt, NOW, "UTC", "w4")).toBe(Math.max(1, Math.round((Date.parse(grade.reviewDueAt) - NOW.getTime()) / 86_400_000)));
    }
  });

  it("reflects the response-time adjustment in the previewed interval", () => {
    const current = { review_state: "review" as const, review_interval_days: 30, review_streak: 4, review_ease: 2.5, learning_step: 3 };
    const neutral = previewSingleInterval(current, { rating: "good", responseTimeMs: 3_000, cardType: "target_to_native" }, NOW, "UTC", "");
    const fast = previewSingleInterval(current, { rating: "good", responseTimeMs: 1_000, cardType: "target_to_native" }, NOW, "UTC", "");
    const slow = previewSingleInterval(current, { rating: "good", responseTimeMs: 10_000, cardType: "target_to_native" }, NOW, "UTC", "");
    expect(neutral).toBe(75);
    expect(fast).toBeGreaterThan(neutral);
    expect(slow).toBeLessThan(neutral);
  });

  it("is deterministic for the same fuzz seed", () => {
    const current = { review_state: "review" as const, review_interval_days: 30, review_streak: 4, review_ease: 2.5, learning_step: 3 };
    const attempt = { rating: "good" as const, responseTimeMs: 0, cardType: "native_to_target" as const };
    expect(previewSingleInterval(current, attempt, NOW, "America/Sao_Paulo", "w3")).toBe(previewSingleInterval(current, attempt, NOW, "America/Sao_Paulo", "w3"));
  });
});
