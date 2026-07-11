import type { RecallRating } from "./flashcard-contracts";

export const REVIEW_VERSION = "srs-v1";

export type ReviewState = "new" | "learning" | "review" | "difficult" | "suspended";
export type ReviewCardType = "target_to_native" | "native_to_target" | "cloze" | "listening";

export type ReviewFields = {
  familiarity_score?: number;
  review_interval_days?: number;
  review_ease?: number;
  review_streak?: number;
  lapse_count?: number;
  last_reviewed_at?: string;
  last_rating?: RecallRating;
  average_response_time_ms?: number;
  review_state?: ReviewState;
  review_version?: string;
};

export type ReviewAttempt = {
  rating: RecallRating;
  responseTimeMs?: number;
  cardType?: ReviewCardType;
};

export type AdaptiveReview = {
  familiarityScore: number;
  reviewIntervalDays: number;
  reviewEase: number;
  reviewStreak: number;
  lapseCount: number;
  lastReviewedAt: string;
  lastRating: RecallRating;
  averageResponseTimeMs: number;
  reviewState: ReviewState;
  reviewVersion: typeof REVIEW_VERSION;
  reviewDueAt: string;
};

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const MAX_INTERVAL_DAYS = 365;
const ratingWeight: Record<RecallRating, number> = { forgot: 0, hard: 1, good: 2, easy: 3 };
const responseTargetMs: Record<ReviewCardType, number> = {
  target_to_native: 3_000,
  native_to_target: 4_000,
  cloze: 6_000,
  listening: 7_000
};

export function aggregateReviewAttempts(attempts: ReviewAttempt[]): ReviewAttempt {
  if (!attempts.length) throw new Error("At least one review attempt is required.");
  return attempts.reduce((worst, attempt) => ratingWeight[attempt.rating] < ratingWeight[worst.rating] ? attempt : worst);
}

export function calculateAdaptiveReview(current: ReviewFields, attempts: ReviewAttempt[], now = new Date(), timeZone = "UTC"): AdaptiveReview {
  const aggregate = aggregateReviewAttempts(attempts);
  const rating = aggregate.rating;
  const priorInterval = clampInt(current.review_interval_days, 1, MAX_INTERVAL_DAYS, 1);
  const priorEase = clampNumber(current.review_ease, MIN_EASE, MAX_EASE, 2.3);
  const priorStreak = clampInt(current.review_streak, 0, 100_000, 0);
  const priorLapses = clampInt(current.lapse_count, 0, 100_000, 0);
  const priorAverage = clampInt(current.average_response_time_ms, 0, 300_000, 0);
  const sessionAverage = average(attempts.map((attempt) => clampInt(attempt.responseTimeMs, 0, 300_000, 0)).filter(Boolean));
  const averageResponseTimeMs = priorAverage && sessionAverage ? Math.round((priorAverage + sessionAverage) / 2) : priorAverage || sessionAverage;
  const responseFactor = responseAdjustment(attempts);

  let reviewIntervalDays = priorInterval;
  let reviewEase = priorEase;
  let reviewStreak = priorStreak;
  let lapseCount = priorLapses;
  let familiarityScore = clampNumber(current.familiarity_score, 0, 10, 0);

  if (rating === "forgot") {
    reviewIntervalDays = 1;
    reviewEase = clampNumber(priorEase - 0.25, MIN_EASE, MAX_EASE, MIN_EASE);
    reviewStreak = 0;
    lapseCount += 1;
    familiarityScore = clampNumber(familiarityScore - 2, 0, 10, 0);
  } else if (rating === "hard") {
    reviewIntervalDays = clampInt(Math.round(priorInterval * 1.2 * responseFactor), 1, 4, 1);
    reviewEase = clampNumber(priorEase - 0.08, MIN_EASE, MAX_EASE, MIN_EASE);
    reviewStreak = Math.max(0, priorStreak - 1);
    familiarityScore = clampNumber(familiarityScore - 0.5, 0, 10, 0);
  } else {
    reviewStreak = priorStreak + 1;
    const initialIntervals = rating === "easy" ? [7, 15, 30, 60] : [3, 7, 15, 30];
    const initialInterval = initialIntervals[Math.min(reviewStreak - 1, initialIntervals.length - 1)];
    const multiplier = rating === "easy" ? (priorEase + 0.35) * 1.25 : priorEase;
    reviewIntervalDays = clampInt(Math.round(Math.max(initialInterval, priorInterval * multiplier * responseFactor)), 1, MAX_INTERVAL_DAYS, initialInterval);
    reviewEase = clampNumber(priorEase + (rating === "easy" ? 0.1 : 0), MIN_EASE, MAX_EASE, priorEase);
    familiarityScore = clampNumber(familiarityScore + (rating === "easy" ? 1.2 : 1), 0, 10, 10);
  }

  const reviewState = deriveReviewState({ current, rating, reviewStreak, lapseCount, averageResponseTimeMs, attempts });
  return {
    familiarityScore: round(familiarityScore, 1),
    reviewIntervalDays,
    reviewEase: round(reviewEase, 2),
    reviewStreak,
    lapseCount,
    lastReviewedAt: now.toISOString(),
    lastRating: rating,
    averageResponseTimeMs,
    reviewState,
    reviewVersion: REVIEW_VERSION,
    reviewDueAt: dueAtInTimeZone(now, reviewIntervalDays, timeZone)
  };
}

function deriveReviewState(input: { current: ReviewFields; rating: RecallRating; reviewStreak: number; lapseCount: number; averageResponseTimeMs: number; attempts: ReviewAttempt[] }): ReviewState {
  if (input.current.review_state === "suspended") return "suspended";
  const slowRepeatedly = input.averageResponseTimeMs >= 8_000 && input.reviewStreak >= 2;
  const repeatedFailure = input.rating === "forgot" && input.current.last_rating === "forgot";
  const repeatedHard = input.rating === "hard" && input.current.last_rating === "hard";
  const frequentLapses = input.lapseCount >= 3 && input.reviewStreak <= 1;
  if (repeatedFailure || repeatedHard || frequentLapses || slowRepeatedly) return "difficult";
  if (input.rating === "forgot" || input.rating === "hard") return "learning";
  return input.reviewStreak >= 2 ? "review" : "learning";
}

function responseAdjustment(attempts: ReviewAttempt[]) {
  const factors = attempts.map((attempt) => {
    const responseTimeMs = clampInt(attempt.responseTimeMs, 0, 300_000, 0);
    if (!responseTimeMs) return 1;
    const target = responseTargetMs[attempt.cardType ?? "target_to_native"];
    if (responseTimeMs <= target * 0.7) return 1.08;
    if (responseTimeMs >= target * 1.6) return 0.9;
    return 1;
  });
  return average(factors) || 1;
}

function dueAtInTimeZone(now: Date, days: number, requestedTimeZone: string) {
  const timeZone = isTimeZone(requestedTimeZone) ? requestedTimeZone : "UTC";
  const local = zonedParts(now, timeZone);
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day) + days * DAY_MS);
  return zonedDateTimeToUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(), hour: 9, minute: 0, second: 0 }, timeZone).toISOString();
}

function zonedDateTimeToUtc(target: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timeZone: string) {
  let value = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const targetValue = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(new Date(value), timeZone);
    const actualValue = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    value += targetValue - actualValue;
  }
  return new Date(value);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function clampInt(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
