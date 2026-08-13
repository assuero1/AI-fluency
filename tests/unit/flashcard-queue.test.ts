import { describe, expect, it } from "vitest";
import { advanceFlashcardQueue, createFlashcardQueue, inferRecallRating, rebuildFlashcardQueue, resolveBinaryRating, resolveDifficultyRating, selectNextQueueItem } from "../../lib/learning/flashcard-queue";
import type { Flashcard } from "../../lib/learning/flashcard-contracts";

const cards = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id } as Flashcard));

describe("flashcard pedagogical queue", () => {
  it("infers ratings from match and response time", () => {
    expect(inferRecallRating({ match: "incorrect", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("forgot");
    expect(inferRecallRating({ match: "minor_error", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("hard");
    expect(inferRecallRating({ match: "exact", forgot: false, responseTimeMs: 3000, cardType: "native_to_target" })).toBe("easy");
    expect(inferRecallRating({ match: "exact", forgot: false, responseTimeMs: 9000, cardType: "native_to_target" })).toBe("good");
  });

  it("resolves the binary choice into a 4-value rating", () => {
    const base = { responseTimeMs: 1000, cardType: "native_to_target" } as const;
    expect(resolveBinaryRating({ ...base, remembered: false, match: "exact", forgot: false })).toBe("forgot");
    expect(resolveBinaryRating({ ...base, remembered: true, match: "incorrect", forgot: false })).toBe("hard");
    expect(resolveBinaryRating({ ...base, remembered: true, match: "incorrect", forgot: true })).toBe("hard");
    expect(resolveBinaryRating({ ...base, remembered: true, match: "minor_error", forgot: false })).toBe("hard");
    expect(resolveBinaryRating({ ...base, remembered: true, match: "exact", forgot: false })).toBe("easy");
    expect(resolveBinaryRating({ ...base, remembered: true, match: "exact", forgot: false, responseTimeMs: 9000 })).toBe("good");
  });

  it("resolves the difficulty choice into a 4-value rating", () => {
    const base = { responseTimeMs: 1000, cardType: "native_to_target" } as const;
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "exact", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "minor_error", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "exact", forgot: false })).toBe("easy");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "exact", forgot: false, responseTimeMs: 9000 })).toBe("good");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "minor_error", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "incorrect", forgot: false })).toBe("forgot");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "unknown", forgot: false })).toBe("forgot");
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "exact", forgot: true })).toBe("forgot");
  });

  it("returns forgotten cards after three other presentations", () => {
    let queue = createFlashcardQueue(cards);
    const first = queue[0];
    queue = advanceFlashcardQueue(queue, first, "forgot", 1);
    const scheduled = queue.find((item) => item.cardId === "a")!;
    expect(scheduled).toEqual({ cardId: "a", presentationNumber: 2, dueAfterIndex: 4 });
    expect(selectNextQueueItem(queue, 3)?.cardId).toBe("b");
    expect(selectNextQueueItem(queue, 4)).toEqual(scheduled);
  });

  it("returns hard cards after five and stops after three presentations", () => {
    const current = { cardId: "a", presentationNumber: 2, dueAfterIndex: 0 };
    const scheduled = advanceFlashcardQueue([current], current, "hard", 7);
    expect(scheduled).toEqual([{ cardId: "a", presentationNumber: 3, dueAfterIndex: 12 }]);
    expect(advanceFlashcardQueue(scheduled, scheduled[0], "forgot", 14)).toEqual([]);
  });

  it("does not reschedule good or easy cards and cannot cycle forever", () => {
    const queue = createFlashcardQueue(cards.slice(0, 1));
    expect(advanceFlashcardQueue(queue, queue[0], "good", 1)).toEqual([]);
    expect(selectNextQueueItem([], 1)).toBeNull();
  });

  it("rebuilds the queue from persisted attempts for resume", () => {
    const rebuilt = rebuildFlashcardQueue(cards.slice(0, 2), [
      { cardId: "a", presentationNumber: 1, rating: "forgot" }
    ]);
    expect(rebuilt.queue).toEqual([
      { cardId: "b", presentationNumber: 1, dueAfterIndex: 0 },
      { cardId: "a", presentationNumber: 2, dueAfterIndex: 4 }
    ]);
    expect(rebuilt.currentItem).toEqual({ cardId: "b", presentationNumber: 1, dueAfterIndex: 0 });
  });

  it("rejects a persisted history that diverges from the queue order", () => {
    expect(() => rebuildFlashcardQueue(cards.slice(0, 2), [
      { cardId: "b", presentationNumber: 1, rating: "good" }
    ])).toThrow("histórico da fila não corresponde");
    expect(() => rebuildFlashcardQueue(cards.slice(0, 2), [
      { cardId: "a", presentationNumber: 2, rating: "good" }
    ])).toThrow("histórico da fila não corresponde");
  });
});
