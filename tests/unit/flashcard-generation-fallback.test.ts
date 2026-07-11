import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn(async () => { throw new Error("AI unavailable"); }) }));

describe("flashcard generation fallback", () => {
  it("keeps a deterministic deck available when AI generation fails", async () => {
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = Array.from({ length: 5 }, (_, index) => ({ id: `word-${index}`, fields: { display_text: `word${index}`, lemma: `word${index}`, translation: `palavra${index}` } })) as never;
    const deck = await buildDeck(words, "English", "B1", "fallback-seed", true);
    expect(deck.cards).toHaveLength(5);
    expect(deck.adapted).toBe(true);
    expect(deck.cards.every((card) => card.generationSource !== "ai")).toBe(true);
  });
});
