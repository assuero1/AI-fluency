import { describe, expect, it } from "vitest";
import {
  computeDailyQueue,
  countNewCardsIntroducedToday,
  DAILY_SESSION_CAP,
  interleaveWords,
  isNewWord,
  normalizeNewCardsQuota,
  selectDifficultWords,
  summarizeDailyQueue
} from "../../lib/learning/daily-queue";
import type { WordFields } from "../../lib/learning/conversations";
import type { TeableRecord } from "../../lib/teable/client";

function word(id: string, fields: Partial<WordFields>): TeableRecord<WordFields> {
  return { id, fields: fields as WordFields };
}

function session(id: string, fields: Record<string, unknown>) {
  return { id, fields: fields as import("../../lib/learning/daily-queue").DailyQueueSessionFields };
}

const NOW = new Date("2026-08-02T15:00:00.000Z");

describe("normalizeNewCardsQuota", () => {
  it("defaults to 10 and clamps to 0..50", () => {
    expect(normalizeNewCardsQuota(undefined)).toBe(10);
    expect(normalizeNewCardsQuota("abc")).toBe(10);
    expect(normalizeNewCardsQuota(-3)).toBe(0);
    expect(normalizeNewCardsQuota(7.6)).toBe(8);
    expect(normalizeNewCardsQuota(99)).toBe(50);
  });
});

describe("isNewWord", () => {
  it("is new only when never reviewed", () => {
    expect(isNewWord(word("a", {}))).toBe(true);
    expect(isNewWord(word("b", { last_reviewed_at: "2026-08-01T13:00:00.000Z" }))).toBe(false);
  });
});

describe("interleaveWords", () => {
  it("returns due order untouched when there are no new cards", () => {
    expect(interleaveWords(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("spreads new cards evenly and deterministically", () => {
    const due = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10"];
    const result = interleaveWords(due, ["n1", "n2"], "seed");
    expect(result).toHaveLength(12);
    expect(result.filter((id) => id.startsWith("n"))).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(result.filter((id) => id.startsWith("d"))).toEqual(due);
    expect(interleaveWords(due, ["n1", "n2"], "seed")).toEqual(result);
    const firstNew = result.findIndex((id) => id.startsWith("n"));
    const secondNew = result.findLastIndex((id) => id.startsWith("n"));
    expect(firstNew).toBeGreaterThan(0);
    expect(secondNew - firstNew).toBeGreaterThan(2);
  });
});

describe("computeDailyQueue", () => {
  const reviewed = (id: string, due: string) => word(id, {
    first_used_at: "2026-07-01T12:00:00.000Z",
    last_reviewed_at: "2026-07-30T13:00:00.000Z",
    review_due_at: due
  });

  it("includes reviews due until end of local day, oldest first", () => {
    const queue = computeDailyQueue([
      reviewed("due-early", "2026-08-01T09:00:00.000Z"),
      reviewed("due-late", "2026-08-02T20:00:00.000Z"),
      reviewed("tomorrow", "2026-08-03T09:00:00.000Z")
    ], { now: NOW, timeZone: "UTC" });
    expect(queue.dueWordIds).toEqual(["due-early", "due-late"]);
  });

  it("respects the local timezone boundary", () => {
    // 2026-08-02T01:00Z is still Aug 1 (22h) in São Paulo: a word due Aug 2 10:00Z
    // is NOT due today there, but IS due today in UTC.
    const atNight = new Date("2026-08-02T01:00:00.000Z");
    const words = [reviewed("target", "2026-08-02T10:00:00.000Z")];
    expect(computeDailyQueue(words, { now: atNight, timeZone: "America/Sao_Paulo" }).dueWordIds).toEqual([]);
    expect(computeDailyQueue(words, { now: atNight, timeZone: "UTC" }).dueWordIds).toEqual(["target"]);
  });

  it("limits new cards by quota minus what was already introduced today", () => {
    const words = [
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" }),
      word("n2", { first_used_at: "2026-07-02T10:00:00.000Z" }),
      word("n3", { first_used_at: "2026-07-03T10:00:00.000Z" })
    ];
    expect(computeDailyQueue(words, { quota: 2, now: NOW }).newWordIds).toEqual(["n1", "n2"]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 1, now: NOW }).newWordIds).toEqual(["n1"]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 2, now: NOW }).newWordIds).toEqual([]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 5, now: NOW }).newWordIds).toEqual([]);
  });

  it("caps the session and moves the overflow to remaining", () => {
    const words = Array.from({ length: 35 }, (_, index) =>
      reviewed(`due-${index}`, "2026-08-01T09:00:00.000Z"));
    const queue = computeDailyQueue(words, { now: NOW });
    expect(queue.sessionWordIds).toHaveLength(DAILY_SESSION_CAP);
    expect(queue.remainingWordIds).toHaveLength(5);
  });

  it("interleaves new cards into the session order", () => {
    const words = [
      reviewed("d1", "2026-08-01T09:00:00.000Z"),
      reviewed("d2", "2026-08-01T09:00:00.000Z"),
      reviewed("d3", "2026-08-01T09:00:00.000Z"),
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" })
    ];
    const queue = computeDailyQueue(words, { quota: 10, now: NOW, seed: "u:2026-08-02" });
    expect(queue.sessionWordIds).toHaveLength(4);
    expect(queue.sessionWordIds[0]).not.toBe("n1");
    expect(new Set(queue.sessionWordIds)).toEqual(new Set(["d1", "d2", "d3", "n1"]));
  });
});

describe("countNewCardsIntroducedToday", () => {
  const dailySession = (id: string, startedAt: string, introduced: number, status = "completed") =>
    session(id, {
      type: "flashcards",
      status,
      user_id: "u1",
      language_profile_id: "p1",
      started_at: startedAt,
      focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: introduced })
    });

  it("sums only today's completed/active daily sessions", () => {
    const sessions = [
      dailySession("s1", "2026-08-02T10:00:00.000Z", 4),
      dailySession("s2", "2026-08-02T12:00:00.000Z", 3, "active"),
      dailySession("s3", "2026-08-02T13:00:00.000Z", 9, "abandoned"),
      dailySession("s4", "2026-08-01T10:00:00.000Z", 7),
      session("s5", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T11:00:00.000Z", focus: JSON.stringify({ queueKind: "custom", newCardsIntroduced: 5 }) }),
      session("s6", { type: "conversation", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T11:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 5 }) })
    ];
    expect(countNewCardsIntroducedToday(sessions, { userId: "u1", profileId: "p1" }, { now: NOW, timeZone: "UTC" })).toBe(7);
  });

  it("ignores sessions from other users and tolerates broken focus JSON", () => {
    const sessions = [
      dailySession("s1", "2026-08-02T10:00:00.000Z", 4),
      session("s2", { type: "flashcards", status: "completed", user_id: "u2", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 6 }) }),
      session("s3", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: "{not-json" })
    ];
    expect(countNewCardsIntroducedToday(sessions, { userId: "u1", profileId: "p1" }, { now: NOW, timeZone: "UTC" })).toBe(4);
  });
});

describe("summarizeDailyQueue", () => {
  it("combines queue and day counting into a UI-ready summary", () => {
    const words = [
      word("d1", { last_reviewed_at: "2026-07-30T13:00:00.000Z", review_due_at: "2026-08-01T09:00:00.000Z" }),
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" }),
      word("hard", { last_reviewed_at: "2026-07-30T13:00:00.000Z", review_due_at: "2026-08-05T09:00:00.000Z", review_state: "difficult" })
    ];
    const sessions = [
      session("s1", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 9 }) })
    ];
    const summary = summarizeDailyQueue(words, sessions, { userId: "u1", profileId: "p1" }, { quota: 10, now: NOW, timeZone: "UTC" });
    expect(summary).toMatchObject({
      dueCount: 1,
      newCount: 1,        // quota 10 - 9 introduzidos = 1 restante
      sessionCardCount: 2,
      introducedToday: 9,
      quota: 10,
      estimatedMinutes: 1,
      difficultCount: 1
    });
  });

  it("reports an empty day honestly", () => {
    const summary = summarizeDailyQueue([], [], { userId: "u1" }, { now: NOW });
    expect(summary).toMatchObject({ dueCount: 0, newCount: 0, sessionCardCount: 0, estimatedMinutes: 0 });
  });
});

describe("selectDifficultWords", () => {
  it("selects difficult or leech-flagged words, most lapses first", () => {
    const selected = selectDifficultWords([
      word("ok", { review_state: "review" }),
      word("leech", { review_state: "review", leech_flagged_at: "2026-08-01T10:00:00.000Z", lapse_count: 5 }),
      word("hard", { review_state: "difficult", lapse_count: 2 }),
      word("harder", { review_state: "difficult", lapse_count: 6 })
    ]);
    expect(selected.map((item) => item.id)).toEqual(["harder", "leech", "hard"]);
  });

  it("breaks lapse ties by earliest due date and caps the selection at 30", () => {
    const tied = selectDifficultWords([
      word("later", { review_state: "difficult", lapse_count: 2, review_due_at: "2026-08-05T09:00:00.000Z" }),
      word("sooner", { review_state: "difficult", lapse_count: 2, review_due_at: "2026-08-01T09:00:00.000Z" })
    ]);
    expect(tied.map((item) => item.id)).toEqual(["sooner", "later"]);

    const many = Array.from({ length: 35 }, (_, index) =>
      word(`d-${index}`, { review_state: "difficult", lapse_count: index }));
    expect(selectDifficultWords(many)).toHaveLength(30);
    expect(selectDifficultWords(many)[0].id).toBe("d-34");
  });
});

describe("daily queue with sense-aggregated word fields", () => {
  // With per-sense SRS (Fase 2), words.review_due_at is the aggregated minimum
  // across the word's senses (aggregateSenseReviewToWordFields). The queue keeps
  // operating on word ids and consumes that cache; the word → most-due-sense
  // resolution happens at card-build time via resolveDueSenses.
  it("queues a word by its aggregated min-due cache, oldest first", () => {
    const queue = computeDailyQueue([
      word("word-two-senses", { last_reviewed_at: "2026-08-01T13:00:00.000Z", review_due_at: "2026-08-02T09:00:00.000Z" }),
      word("word-one-sense", { last_reviewed_at: "2026-08-01T13:00:00.000Z", review_due_at: "2026-08-01T09:00:00.000Z" }),
      word("word-all-future", { last_reviewed_at: "2026-08-01T13:00:00.000Z", review_due_at: "2026-08-10T09:00:00.000Z" })
    ], { now: NOW, timeZone: "UTC" });

    expect(queue.dueWordIds).toEqual(["word-one-sense", "word-two-senses"]);
    expect(queue.sessionWordIds).toEqual(["word-one-sense", "word-two-senses"]);
  });

  it("keeps the daily quota word-level: a reviewed word stays non-new even when a new sense exists", () => {
    // Fase 2 accepts that a NEW SENSE of an already-reviewed word does not consume
    // the new-card quota (novelty is tracked via the aggregated last_reviewed_at).
    expect(isNewWord(word("reviewed-with-new-sense", { last_reviewed_at: "2026-08-01T13:00:00.000Z" }))).toBe(false);
    expect(isNewWord(word("never-reviewed", {}))).toBe(true);
  });
});
