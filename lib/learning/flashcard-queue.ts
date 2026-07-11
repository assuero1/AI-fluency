import type { AnswerMatch, Flashcard, QueueItem, RecallRating } from "./flashcard-contracts";

export function createFlashcardQueue(cards: Flashcard[]): QueueItem[] {
  return cards.map((card) => ({ cardId: card.id, presentationNumber: 1, dueAfterIndex: 0 }));
}

export function suggestRecallRating(input: { match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating {
  if (input.forgot || input.match === "incorrect") return "forgot";
  if (input.match === "minor_error" || input.match === "unknown") return "hard";
  const fastThreshold = input.cardType === "cloze" ? 10_000 : 6_000;
  return input.responseTimeMs > 0 && input.responseTimeMs <= fastThreshold ? "easy" : "good";
}

export function advanceFlashcardQueue(queue: QueueItem[], current: QueueItem, rating: RecallRating, completedPresentationCount: number): QueueItem[] {
  const remaining = queue.filter((item) => item !== current);
  if ((rating === "forgot" || rating === "hard") && current.presentationNumber < 3) {
    const delay = rating === "forgot" ? 3 : 5;
    remaining.push({
      cardId: current.cardId,
      presentationNumber: current.presentationNumber + 1,
      dueAfterIndex: completedPresentationCount + delay
    });
  }
  return remaining;
}

export function selectNextQueueItem(queue: QueueItem[], completedPresentationCount: number): QueueItem | null {
  if (!queue.length) return null;
  const eligible = queue.filter((item) => item.dueAfterIndex <= completedPresentationCount);
  return eligible.sort((a, b) => b.dueAfterIndex - a.dueAfterIndex)[0]
    ?? [...queue].sort((a, b) => a.dueAfterIndex - b.dueAfterIndex || a.presentationNumber - b.presentationNumber)[0];
}

export function isRatingCorrect(rating: RecallRating) {
  return rating === "good" || rating === "easy";
}

export function rebuildFlashcardQueue(cards: Flashcard[], attempts: Array<{ cardId: string; presentationNumber: number; rating: RecallRating }>) {
  let queue = createFlashcardQueue(cards);
  for (const [index, attempt] of attempts.entries()) {
    const expected = selectNextQueueItem(queue, index);
    if (!expected || expected.cardId !== attempt.cardId || expected.presentationNumber !== attempt.presentationNumber) {
      throw new Error("O histórico da fila não corresponde às apresentações persistidas.");
    }
    queue = advanceFlashcardQueue(queue, expected, attempt.rating, index + 1);
  }
  return { queue, currentItem: selectNextQueueItem(queue, attempts.length) };
}
