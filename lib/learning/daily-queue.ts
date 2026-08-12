import type { TeableRecord } from "@/lib/teable/client";
import type { DailyQueueSummary } from "./flashcard-contracts";
import { hashSeed, zonedDateTimeToUtc, zonedParts } from "./spaced-repetition";

export const DAILY_SESSION_CAP = 30;
export const DEFAULT_NEW_CARDS_QUOTA = 10;
export const MAX_NEW_CARDS_QUOTA = 50;

// Minimal structural shape the queue needs — satisfied by both the full
// `WordFields` (conversations.ts) and the leaner local type in home.ts.
export type DailyQueueWordFields = {
  first_used_at?: string;
  last_reviewed_at?: string;
  review_due_at?: string;
  review_state?: string;
  leech_flagged_at?: string | null;
  lapse_count?: number;
};

export type DailyQueueSessionFields = {
  type?: string;
  status?: string;
  user_id?: string;
  language_profile_id?: string;
  started_at?: string;
  created_at?: string;
  focus?: string;
};

export type DailyQueue = {
  dueWordIds: string[];
  newWordIds: string[];
  sessionWordIds: string[];
  remainingWordIds: string[];
  quota: number;
  introducedToday: number;
  newAvailable: number;
};

export function normalizeNewCardsQuota(value: unknown, fallback = DEFAULT_NEW_CARDS_QUOTA) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_NEW_CARDS_QUOTA, Math.max(0, Math.round(number)));
}

// "New" in the SRS sense: never reviewed in a flashcard session.
// NOTE (per-sense SRS): novelty is tracked at word level via the aggregated
// last_reviewed_at cache, so a NEW SENSE of an already-reviewed word does not
// consume the daily new-card quota. Accepted in this phase; per-sense quota
// rules are a future refinement.
// NOTE (supporting words): reviews of supporting words (from AI cloze
// phrases) update the word-level cache directly, bypassing the sense layer;
// for a multi-sense word the next sense-targeted review re-aggregates the
// cache from the senses and discards that review's SRS effect. Accepted
// limitation of this phase — follow-up ticket candidate.
export function isNewWord(word: TeableRecord<DailyQueueWordFields>) {
  return !dateValue(word.fields.last_reviewed_at);
}

export function computeDailyQueue<T extends TeableRecord<DailyQueueWordFields>>(
  words: T[],
  options: { quota?: number; introducedToday?: number; now?: Date; timeZone?: string; sessionCap?: number; seed?: string } = {}
): DailyQueue {
  const quota = normalizeNewCardsQuota(options.quota);
  const introducedToday = Math.max(0, Math.round(Number(options.introducedToday) || 0));
  const cap = Math.max(1, Math.round(Number(options.sessionCap) || DAILY_SESSION_CAP));
  const dayEnd = localDayBounds(options.now ?? new Date(), options.timeZone ?? "UTC").end;
  const due = words
    .filter((word) => !isNewWord(word) && dateValue(word.fields.review_due_at) > 0 && dateValue(word.fields.review_due_at) <= dayEnd)
    .sort((a, b) => dateValue(a.fields.review_due_at) - dateValue(b.fields.review_due_at));
  const newCandidates = words
    .filter((word) => isNewWord(word))
    .sort((a, b) => dateValue(a.fields.first_used_at) - dateValue(b.fields.first_used_at));
  const newWordIds = newCandidates.slice(0, Math.max(0, quota - introducedToday)).map((word) => word.id);
  const interleaved = interleaveWords(due.map((word) => word.id), newWordIds, options.seed ?? "");
  return {
    dueWordIds: due.map((word) => word.id),
    newWordIds,
    sessionWordIds: interleaved.slice(0, cap),
    remainingWordIds: interleaved.slice(cap),
    quota,
    introducedToday,
    newAvailable: newCandidates.length
  };
}

// Spreads new cards evenly among due reviews, deterministically.
export function interleaveWords(dueWordIds: string[], newWordIds: string[], seed = "") {
  if (!newWordIds.length) return [...dueWordIds];
  if (!dueWordIds.length) return [...newWordIds];
  const orderedNew = [...newWordIds].sort((a, b) => hashSeed(`${seed}:${a}`) - hashSeed(`${seed}:${b}`));
  const total = dueWordIds.length + orderedNew.length;
  const newPositions = new Set(orderedNew.map((_, index) => Math.round(((index + 1) * total) / (orderedNew.length + 1)) - 1));
  const merged: string[] = [];
  let dueIndex = 0;
  let newIndex = 0;
  for (let position = 0; position < total; position += 1) {
    if (newPositions.has(position) && newIndex < orderedNew.length) {
      merged.push(orderedNew[newIndex]);
      newIndex += 1;
    } else {
      merged.push(dueWordIds[dueIndex]);
      dueIndex += 1;
    }
  }
  return merged;
}

// New cards introduced today count only completed/active daily sessions started
// in the local day (abandoned sessions do not burn quota).
export function countNewCardsIntroducedToday<T extends TeableRecord<DailyQueueSessionFields>>(
  sessions: T[],
  scope: { userId: string; profileId?: string },
  options: { now?: Date; timeZone?: string } = {}
) {
  const dayStart = localDayBounds(options.now ?? new Date(), options.timeZone ?? "UTC").start;
  return sessions
    .filter((session) => session.fields.type === "flashcards"
      && (session.fields.status === "completed" || session.fields.status === "active")
      && session.fields.user_id === scope.userId
      && (!scope.profileId || session.fields.language_profile_id === scope.profileId)
      && dateValue(session.fields.started_at || session.fields.created_at) >= dayStart)
    .reduce((total, session) => {
      const focus = parseSessionFocus(session.fields.focus);
      return total + (focus.queueKind === "daily" ? Math.max(0, Math.round(Number(focus.newCardsIntroduced) || 0)) : 0);
    }, 0);
}

export function summarizeDailyQueue<W extends TeableRecord<DailyQueueWordFields>, S extends TeableRecord<DailyQueueSessionFields>>(
  words: W[],
  sessions: S[],
  scope: { userId: string; profileId?: string },
  options: { quota?: number; now?: Date; timeZone?: string; sessionCap?: number } = {}
): DailyQueueSummary {
  const now = options.now ?? new Date();
  const introducedToday = countNewCardsIntroducedToday(sessions, scope, { ...options, now });
  const queue = computeDailyQueue(words, { ...options, now, introducedToday, seed: `${scope.userId}:${localDayStamp(now, options.timeZone ?? "UTC")}` });
  return {
    dueCount: queue.dueWordIds.length,
    newCount: queue.newWordIds.length,
    sessionCardCount: queue.sessionWordIds.length,
    remainingCount: queue.remainingWordIds.length,
    newAvailable: queue.newAvailable,
    introducedToday,
    quota: queue.quota,
    estimatedMinutes: queue.sessionWordIds.length ? Math.max(1, Math.ceil(queue.sessionWordIds.length / 5)) : 0,
    difficultCount: selectDifficultWords(words).length
  };
}

export function selectDifficultWords<T extends TeableRecord<DailyQueueWordFields>>(words: T[], cap = DAILY_SESSION_CAP): T[] {
  return words
    .filter((word) => word.fields.review_state === "difficult" || Boolean(word.fields.leech_flagged_at))
    .sort((a, b) => Number(b.fields.lapse_count ?? 0) - Number(a.fields.lapse_count ?? 0) || dateValue(a.fields.review_due_at) - dateValue(b.fields.review_due_at))
    .slice(0, cap);
}

function localDayBounds(now: Date, timeZone: string) {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = zonedParts(now, zone);
  const day = { year: local.year, month: local.month, day: local.day };
  return {
    start: zonedDateTimeToUtc({ ...day, hour: 0, minute: 0, second: 0 }, zone).getTime(),
    end: zonedDateTimeToUtc({ ...day, hour: 23, minute: 59, second: 59 }, zone).getTime()
  };
}

function localDayStamp(now: Date, timeZone: string) {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = zonedParts(now, zone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

function parseSessionFocus(value: string | undefined): { queueKind?: string; newCardsIntroduced?: number } {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as { queueKind?: string; newCardsIntroduced?: number } : {};
  } catch {
    return {};
  }
}

function isValidTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function dateValue(value: string | undefined) {
  const time = value ? Date.parse(value) : 0;
  return Number.isNaN(time) ? 0 : time;
}
