import { describe, expect, it, vi } from "vitest";

const { createChatCompletion } = vi.hoisted(() => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

// Reset at the start of each test (not in beforeEach): without it the
// toHaveBeenCalledTimes counts accumulate between tests, and in beforeEach
// vitest 4.1 misreports the caught rejection as an unhandled error.

describe("flashcard generation fallback", () => {
  it("keeps a deterministic target_to_native deck available when AI generation fails", async () => {
    createChatCompletion.mockReset();
    createChatCompletion.mockRejectedValue(new Error("AI unavailable"));
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = Array.from({ length: 5 }, (_, index) => ({ id: `word-${index}`, fields: { display_text: `word${index}`, lemma: `word${index}`, translation: `palavra${index}` } })) as never;
    const deck = await buildDeck(words, "English", "B1", "fallback-seed", Array.from({ length: 5 }, () => "target_to_native" as const));
    expect(deck.cards).toHaveLength(5);
    expect(deck.adapted).toBe(false);
    expect(deck.cards.every((card) => card.type === "target_to_native")).toBe(true);
    expect(deck.cards.every((card) => card.prompt === `word${card.targetWordId.replace("word-", "")}`)).toBe(true);
    expect(deck.cards.every((card) => card.expectedAnswer === `palavra${card.targetWordId.replace("word-", "")}`)).toBe(true);
    expect(deck.cards.every((card) => card.generationSource !== "ai")).toBe(true);
  });

  it("retries the phrase generation once and recovers cloze cards", async () => {
    createChatCompletion.mockReset();
    createChatCompletion
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ content: JSON.stringify({ phrases: [{ text: "yo fui ayer", translation: "eu fui ontem", word_ids: ["word-0"] }] }) });
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = [{ id: "word-0", fields: { display_text: "fui", lemma: "fui", translation: "fui" } }] as never;
    const deck = await buildDeck(words, "Espanhol", "B1", "retry-seed", ["cloze"]);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(deck.cards[0].type).toBe("cloze");
  }, 15_000);

  it("gives up after one retry and keeps the deterministic fallback", async () => {
    createChatCompletion.mockReset();
    createChatCompletion.mockRejectedValue(new Error("AI unavailable"));
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = [{ id: "word-0", fields: { display_text: "fui", lemma: "fui", translation: "fui" } }] as never;
    const deck = await buildDeck(words, "Espanhol", "B1", "retry-seed", ["cloze"]);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(deck.cards[0].type).not.toBe("cloze");
    expect(deck.adapted).toBe(true);
  }, 15_000);
});
