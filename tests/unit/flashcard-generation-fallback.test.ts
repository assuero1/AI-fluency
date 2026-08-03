import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn(async () => { throw new Error("AI unavailable"); }) }));

describe("flashcard generation fallback", () => {
  it("keeps a deterministic target_to_native deck available when AI generation fails", async () => {
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
});
