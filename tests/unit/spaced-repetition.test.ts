import { describe, expect, it } from "vitest";
import { aggregateReviewAttempts, calculateAdaptiveReview, REVIEW_VERSION } from "../../lib/learning/spaced-repetition";

const now = new Date("2026-07-10T12:00:00.000Z");

describe("adaptive spaced repetition", () => {
  it("starts a first successful review in learning with a three-day interval", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "good", responseTimeMs: 3_000, cardType: "target_to_native" }], now);
    expect(review).toMatchObject({ reviewIntervalDays: 3, reviewEase: 2.3, reviewStreak: 1, lapseCount: 0, reviewState: "learning", reviewVersion: REVIEW_VERSION, lastRating: "good" });
  });

  it("uses the initial success ladder and then retains a mastered interval", () => {
    const second = calculateAdaptiveReview({ review_streak: 1, review_interval_days: 3, review_ease: 2.3 }, [{ rating: "good", responseTimeMs: 3_000 }], now);
    const mastered = calculateAdaptiveReview({ review_streak: 4, review_interval_days: 60, review_ease: 2.5, review_state: "review" }, [{ rating: "easy", responseTimeMs: 1_000 }], now);
    expect(second).toMatchObject({ reviewIntervalDays: 7, reviewStreak: 2, reviewState: "review" });
    expect(mastered.reviewIntervalDays).toBeGreaterThan(60);
    expect(mastered.reviewEase).toBe(2.6);
  });

  it("resets after a lapse and classifies consecutive failures as difficult", () => {
    const review = calculateAdaptiveReview({ review_interval_days: 30, review_ease: 2.6, review_streak: 5, lapse_count: 1, last_rating: "forgot", familiarity_score: 8 }, [{ rating: "forgot", responseTimeMs: 2_000 }], now);
    expect(review).toMatchObject({ reviewIntervalDays: 1, reviewEase: 2.35, reviewStreak: 0, lapseCount: 2, reviewState: "difficult", familiarityScore: 6 });
  });

  it("keeps hard reviews between one and four days", () => {
    const review = calculateAdaptiveReview({ review_interval_days: 30, review_ease: 1.3, review_streak: 3 }, [{ rating: "hard", responseTimeMs: 3_000 }], now);
    expect(review).toMatchObject({ reviewIntervalDays: 4, reviewEase: 1.3, reviewStreak: 2 });
  });

  it("aggregates multiple cards for one word by their worst result", () => {
    const aggregate = aggregateReviewAttempts([{ rating: "easy", responseTimeMs: 1_000 }, { rating: "forgot", responseTimeMs: 2_000 }, { rating: "good", responseTimeMs: 2_000 }]);
    const review = calculateAdaptiveReview({ review_interval_days: 15, review_streak: 3 }, [{ rating: "easy" }, { rating: "forgot" }], now);
    expect(aggregate.rating).toBe("forgot");
    expect(review).toMatchObject({ reviewIntervalDays: 1, reviewStreak: 0, lastRating: "forgot" });
  });

  it("applies only a moderate response-time adjustment without changing correctness", () => {
    const fast = calculateAdaptiveReview({ review_interval_days: 20, review_streak: 4 }, [{ rating: "good", responseTimeMs: 1_000, cardType: "target_to_native" }], now);
    const slow = calculateAdaptiveReview({ review_interval_days: 20, review_streak: 4 }, [{ rating: "good", responseTimeMs: 20_000, cardType: "cloze" }], now);
    expect(fast.reviewIntervalDays).toBeGreaterThan(slow.reviewIntervalDays);
    expect(slow.lastRating).toBe("good");
  });

  it("keeps due dates on the learner calendar across a timezone offset", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "forgot" }], new Date("2026-07-10T02:30:00.000Z"), "America/Sao_Paulo");
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(review.reviewDueAt));
    expect(localDate).toBe("2026-07-10");
  });

  it("normalizes incomplete legacy data and caps the largest interval", () => {
    const review = calculateAdaptiveReview({ review_interval_days: 9_999, review_ease: 99, review_streak: -2, lapse_count: -1, review_state: "new" }, [{ rating: "easy" }], now, "not/a-timezone");
    expect(review).toMatchObject({ reviewIntervalDays: 365, reviewEase: 2.8, reviewStreak: 1, lapseCount: 0, reviewVersion: REVIEW_VERSION });
  });

  it("preserves a suspended word while recording the review fields", () => {
    const review = calculateAdaptiveReview({ review_state: "suspended" }, [{ rating: "good" }], now);
    expect(review.reviewState).toBe("suspended");
  });
});
