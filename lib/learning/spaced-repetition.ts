import type { RecallRating } from "./flashcard-contracts";

export const REVIEW_VERSION = "srs-v2";
export const LEARNING_STEPS_DAYS = [1, 3] as const;
export const LEECH_LAPSE_THRESHOLD = 4;

export type ReviewState = "new" | "learning" | "review" | "difficult" | "suspended";
export type ReviewCardType = "target_to_native" | "native_to_target" | "cloze" | "listening";

export type ReviewFields = {
  familiarity_score?: number;
  review_interval_days?: number;
  review_ease?: number;
  review_streak?: number;
  lapse_count?: number;
  learning_step?: number;
  last_reviewed_at?: string;
  last_rating?: RecallRating;
  average_response_time_ms?: number;
  review_state?: ReviewState;
  review_version?: string;
  leech_flagged_at?: string | null;
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
  learningStep: number;
  lastReviewedAt: string;
  lastRating: RecallRating;
  averageResponseTimeMs: number;
  reviewState: ReviewState;
  reviewVersion: typeof REVIEW_VERSION;
  reviewDueAt: string;
  leechFlaggedAt: string | null;
};

type ScheduleState = {
  familiarityScore: number;
  intervalDays: number;
  ease: number;
  streak: number;
  lapseCount: number;
  learningStep: number;
  graduated: boolean;
};

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const MAX_INTERVAL_DAYS = 365;
const responseTargetMs: Record<ReviewCardType, number> = {
  target_to_native: 3_000,
  native_to_target: 4_000,
  cloze: 6_000,
  listening: 7_000
};

// Applies each attempt in order (fold). In-session recovery is credited, matching
// the incremental persistence model where each attempt is applied as it happens.
export function calculateAdaptiveReview(current: ReviewFields, attempts: ReviewAttempt[], now = new Date(), timeZone = "UTC", fuzzSeed = ""): AdaptiveReview {
  if (!attempts.length) throw new Error("At least one review attempt is required.");
  const graduated = isGraduated(current);
  let state: ScheduleState = {
    familiarityScore: clampNumber(current.familiarity_score, 0, 10, 0),
    intervalDays: clampInt(current.review_interval_days, 1, MAX_INTERVAL_DAYS, 1),
    ease: clampNumber(current.review_ease, MIN_EASE, MAX_EASE, 2.3),
    streak: clampInt(current.review_streak, 0, 100_000, 0),
    lapseCount: clampInt(current.lapse_count, 0, 100_000, 0),
    // Graduated words persist learning_step = LEARNING_STEPS_DAYS.length + 1.
    learningStep: graduated ? LEARNING_STEPS_DAYS.length + 1 : clampInt(current.learning_step, 0, LEARNING_STEPS_DAYS.length, 0),
    graduated
  };
  let dueDays = state.intervalDays;
  let rating: RecallRating = attempts[attempts.length - 1].rating;
  let averageResponseTimeMs = clampInt(current.average_response_time_ms, 0, 300_000, 0);
  for (const attempt of attempts) {
    const result = applyReviewAttempt(state, attempt, fuzzSeed);
    state = result.state;
    dueDays = result.dueDays;
    rating = attempt.rating;
    const responseTimeMs = clampInt(attempt.responseTimeMs, 0, 300_000, 0);
    if (responseTimeMs) averageResponseTimeMs = averageResponseTimeMs ? Math.round((averageResponseTimeMs + responseTimeMs) / 2) : responseTimeMs;
  }
  const leechFlaggedAt = state.lapseCount >= LEECH_LAPSE_THRESHOLD
    ? current.leech_flagged_at || now.toISOString()
    : current.leech_flagged_at || null;
  const reviewState = deriveReviewState({
    suspended: current.review_state === "suspended",
    graduated: state.graduated,
    rating,
    lastRating: current.last_rating,
    streak: state.streak,
    lapseCount: state.lapseCount,
    averageResponseTimeMs
  });
  return {
    familiarityScore: round(state.familiarityScore, 1),
    reviewIntervalDays: state.intervalDays,
    reviewEase: round(state.ease, 2),
    reviewStreak: state.streak,
    lapseCount: state.lapseCount,
    learningStep: state.learningStep,
    lastReviewedAt: now.toISOString(),
    lastRating: rating,
    averageResponseTimeMs,
    reviewState,
    reviewVersion: REVIEW_VERSION,
    reviewDueAt: dueAtInTimeZone(now, dueDays, timeZone),
    leechFlaggedAt
  };
}

// Maps a computed review to a `words` table update (shared by incremental and batch paths).
export function reviewToWordFields(review: AdaptiveReview) {
  return {
    familiarity_score: review.familiarityScore,
    review_due_at: review.reviewDueAt,
    review_interval_days: review.reviewIntervalDays,
    review_ease: review.reviewEase,
    review_streak: review.reviewStreak,
    lapse_count: review.lapseCount,
    learning_step: review.learningStep,
    last_reviewed_at: review.lastReviewedAt,
    last_rating: review.lastRating,
    average_response_time_ms: review.averageResponseTimeMs,
    review_state: review.reviewState,
    review_version: review.reviewVersion,
    ...(review.leechFlaggedAt ? { leech_flagged_at: review.leechFlaggedAt } : {})
  };
}

function isGraduated(current: ReviewFields) {
  if (typeof current.learning_step === "number") return current.learning_step > LEARNING_STEPS_DAYS.length;
  // Legacy words (srs-v1) have no learning_step: infer from the persisted state.
  if (current.review_state === "review") return true;
  if (current.review_state === "difficult") return clampInt(current.review_interval_days, 1, MAX_INTERVAL_DAYS, 1) > LEARNING_STEPS_DAYS[LEARNING_STEPS_DAYS.length - 1];
  return false;
}

function applyReviewAttempt(state: ScheduleState, attempt: ReviewAttempt, fuzzSeed: string): { state: ScheduleState; dueDays: number } {
  const rating = attempt.rating;
  const factor = responseAdjustment(attempt);
  const next = { ...state };
  let dueDays: number;

  if (!state.graduated) {
    const isRelearning = state.lapseCount > 0;
    if (rating === "forgot") {
      next.learningStep = 0;
      next.ease = clampNumber(state.ease - 0.25, MIN_EASE, MAX_EASE, MIN_EASE);
      next.streak = 0;
      next.familiarityScore = clampNumber(state.familiarityScore - 2, 0, 10, 0);
      if (isRelearning) next.lapseCount = state.lapseCount + 1;
      dueDays = LEARNING_STEPS_DAYS[0];
    } else if (rating === "hard") {
      // Repeat the current step's due without advancing.
      next.ease = clampNumber(state.ease - 0.08, MIN_EASE, MAX_EASE, MIN_EASE);
      next.streak = Math.max(0, state.streak - 1);
      next.familiarityScore = clampNumber(state.familiarityScore - 0.5, 0, 10, 0);
      dueDays = learningStepDueDays(state.learningStep);
    } else {
      next.streak = state.streak + 1;
      const nextStep = state.learningStep + (rating === "easy" ? 2 : 1);
      next.ease = clampNumber(state.ease + (rating === "easy" ? 0.1 : 0), MIN_EASE, MAX_EASE, state.ease);
      next.familiarityScore = clampNumber(state.familiarityScore + (rating === "easy" ? 1.2 : 1), 0, 10, 10);
      if (nextStep > LEARNING_STEPS_DAYS.length) {
        next.graduated = true;
        next.learningStep = LEARNING_STEPS_DAYS.length + 1;
        const graduatedInterval = isRelearning
          ? clampInt(Math.round(state.intervalDays * (rating === "easy" ? 0.75 : 0.5)), 4, MAX_INTERVAL_DAYS, 4)
          : rating === "easy" ? 15 : 7;
        next.intervalDays = fuzzInterval(graduatedInterval, fuzzSeed);
        dueDays = next.intervalDays;
      } else {
        next.learningStep = nextStep;
        dueDays = learningStepDueDays(nextStep);
      }
    }
  } else if (rating === "forgot") {
    // Lapse: relearning from step zero; intervalDays keeps the pre-lapse value for regraduation.
    next.graduated = false;
    next.learningStep = 0;
    next.lapseCount = state.lapseCount + 1;
    next.ease = clampNumber(state.ease - 0.25, MIN_EASE, MAX_EASE, MIN_EASE);
    next.streak = 0;
    next.familiarityScore = clampNumber(state.familiarityScore - 2, 0, 10, 0);
    dueDays = LEARNING_STEPS_DAYS[0];
  } else if (rating === "hard") {
    next.intervalDays = clampInt(Math.round(state.intervalDays * 1.2 * factor), 1, 4, 1);
    next.ease = clampNumber(state.ease - 0.08, MIN_EASE, MAX_EASE, MIN_EASE);
    next.streak = Math.max(0, state.streak - 1);
    next.familiarityScore = clampNumber(state.familiarityScore - 0.5, 0, 10, 0);
    dueDays = next.intervalDays;
  } else {
    next.streak = state.streak + 1;
    const initialIntervals = rating === "easy" ? [7, 15, 30, 60] : [3, 7, 15, 30];
    const initialInterval = initialIntervals[Math.min(next.streak - 1, initialIntervals.length - 1)];
    const multiplier = rating === "easy" ? (state.ease + 0.35) * 1.25 : state.ease;
    const interval = clampInt(Math.round(Math.max(initialInterval, state.intervalDays * multiplier * factor)), 1, MAX_INTERVAL_DAYS, initialInterval);
    next.intervalDays = fuzzInterval(interval, fuzzSeed);
    next.ease = clampNumber(state.ease + (rating === "easy" ? 0.1 : 0), MIN_EASE, MAX_EASE, state.ease);
    next.familiarityScore = clampNumber(state.familiarityScore + (rating === "easy" ? 1.2 : 1), 0, 10, 10);
    dueDays = next.intervalDays;
  }
  return { state: next, dueDays };
}

// Due days for the current learning step (step 0 also maps to the first step).
function learningStepDueDays(step: number) {
  return LEARNING_STEPS_DAYS[clampInt(step - 1, 0, LEARNING_STEPS_DAYS.length - 1, 0)];
}

function deriveReviewState(input: { suspended: boolean; graduated: boolean; rating: RecallRating; lastRating?: RecallRating; streak: number; lapseCount: number; averageResponseTimeMs: number }): ReviewState {
  if (input.suspended) return "suspended";
  const slowRepeatedly = input.averageResponseTimeMs >= 8_000 && input.streak >= 2;
  const repeatedFailure = input.rating === "forgot" && input.lastRating === "forgot";
  const repeatedHard = input.rating === "hard" && input.lastRating === "hard";
  const frequentLapses = input.lapseCount >= 3 && input.streak <= 1;
  if (repeatedFailure || repeatedHard || frequentLapses || slowRepeatedly) return "difficult";
  return input.graduated ? "review" : "learning";
}

function responseAdjustment(attempt: ReviewAttempt) {
  const responseTimeMs = clampInt(attempt.responseTimeMs, 0, 300_000, 0);
  if (!responseTimeMs) return 1;
  const target = responseTargetMs[attempt.cardType ?? "target_to_native"];
  if (responseTimeMs <= target * 0.7) return 1.08;
  if (responseTimeMs >= target * 1.6) return 0.9;
  return 1;
}

// Deterministic ±10% fuzz so cards reviewed together stop sharing due dates.
function fuzzInterval(intervalDays: number, seed: string) {
  if (!seed || intervalDays < 7) return intervalDays;
  const range = Math.max(1, Math.round(intervalDays * 0.1));
  const hash = hashSeed(`${seed}:${intervalDays}`);
  const offset = (hash % (2 * range + 1)) - range;
  return clampInt(intervalDays + offset, 1, MAX_INTERVAL_DAYS, intervalDays);
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
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

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
