import { describe, expect, it } from "vitest";
import { advanceFlashcardQueue, createFlashcardQueue, selectNextQueueItem, suggestRecallRating } from "../../lib/learning/flashcard-queue";
import type { Flashcard } from "../../lib/learning/flashcard-contracts";

const cards = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id } as Flashcard));

describe("flashcard pedagogical queue", () => {
  it("suggests ratings from match and response time", () => {
    expect(suggestRecallRating({ match: "incorrect", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("forgot");
    expect(suggestRecallRating({ match: "minor_error", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("hard");
    expect(suggestRecallRating({ match: "exact", forgot: false, responseTimeMs: 3000, cardType: "native_to_target" })).toBe("easy");
    expect(suggestRecallRating({ match: "exact", forgot: false, responseTimeMs: 9000, cardType: "native_to_target" })).toBe("good");
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
});
