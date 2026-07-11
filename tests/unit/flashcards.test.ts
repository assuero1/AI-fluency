import { describe, expect, it } from "vitest";
import {
  calculateLegacyWordReview,
  getActiveRecallDistribution,
  normalizeFlashcardCount,
  normalizeFlashcardCriterion,
  seededShuffle,
  selectFlashcardWords,
  validateFlashcardAnswers,
  validateGeneratedPhrases
} from "../../lib/learning/flashcards";
import type { WordFields } from "../../lib/learning/conversations";
import type { TeableRecord } from "../../lib/teable/client";

function word(id: string, fields: Partial<WordFields>): TeableRecord<WordFields> {
  return { id, fields: fields as WordFields };
}

describe("current flashcard behavior", () => {
  it("normalizes criterion and requested deck size", () => {
    expect(normalizeFlashcardCriterion("oldest")).toBe("oldest");
    expect(normalizeFlashcardCriterion("invalid")).toBe("least_used");
    expect(normalizeFlashcardCount(undefined)).toBe(10);
    expect(normalizeFlashcardCount(1)).toBe(2);
    expect(normalizeFlashcardCount(18.6)).toBe(19);
    expect(normalizeFlashcardCount(99)).toBe(30);
  });

  it("prioritizes fewer uses and then lower familiarity", () => {
    const selected = selectFlashcardWords([
      word("frequent", { total_uses: 4, familiarity_score: 1 }),
      word("less-familiar", { total_uses: 1, familiarity_score: 2 }),
      word("more-familiar", { total_uses: 1, familiarity_score: 8 })
    ], "least_used", 2);

    expect(selected.map((item) => item.id)).toEqual(["less-familiar", "more-familiar"]);
  });

  it("prioritizes the oldest use and falls back to first use", () => {
    const selected = selectFlashcardWords([
      word("recent", { first_used_at: "2026-07-01T00:00:00.000Z", last_used_at: "2026-07-09T00:00:00.000Z" }),
      word("old", { first_used_at: "2026-06-01T00:00:00.000Z", last_used_at: "2026-06-15T00:00:00.000Z" }),
      word("never-reused", { first_used_at: "2026-06-20T00:00:00.000Z" })
    ], "oldest", 3);

    expect(selected.map((item) => item.id)).toEqual(["old", "never-reused", "recent"]);
  });

  it("uses the active-recall distribution and small-deck rules", () => {
    expect(getActiveRecallDistribution(2)).toEqual({ targetToNative: 1, nativeToTarget: 1, cloze: 0, listening: 0 });
    expect(getActiveRecallDistribution(3)).toEqual({ targetToNative: 1, nativeToTarget: 1, cloze: 1, listening: 0 });
    expect(getActiveRecallDistribution(10)).toEqual({ targetToNative: 3, nativeToTarget: 2, cloze: 5, listening: 0 });
    expect(getActiveRecallDistribution(10, true)).toEqual({ targetToNative: 3, nativeToTarget: 2, cloze: 3, listening: 2 });
  });

  it("reproduces the same shuffled deck from the persisted seed", () => {
    const source = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(source, "session-seed")).toEqual(seededShuffle(source, "session-seed"));
    expect(seededShuffle(source, "session-seed")).not.toEqual(source);
    expect(source).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("accepts one matching answer per persisted card", () => {
    const cards = [activeCard("card-a", "word-a", "hola", "olá"), activeCard("card-b", "word-b", "buen día", "bom dia")];
    const validated = validateFlashcardAnswers(cards, [
      attempt("card-a", 1, "olá", "good"),
      attempt("card-b", 1, "", "forgot", true)
    ]);
    expect(validated).toHaveLength(2);
    expect(validated.map((answer) => answer.matchResult)).toEqual(["exact", "incorrect"]);
  });

  it("rejects duplicate, missing, or tampered card answers", () => {
    const cards = [activeCard("card-a", "word-a", "hola", "olá")];
    expect(() => validateFlashcardAnswers(cards, [])).toThrow("entre uma e três apresentações");
    expect(() => validateFlashcardAnswers(cards, [attempt("other", 1, "olá", "good")])).toThrow("não correspondem ao baralho");
    expect(() => validateFlashcardAnswers(cards, [attempt("card-a", 1, "", "good")])).toThrow("Informe uma resposta");
  });

  it("accepts sequential re-presentations and rejects gaps or a fourth attempt", () => {
    const cards = [activeCard("card-a", "word-a", "hola", "olá")];
    expect(validateFlashcardAnswers(cards, [attempt("card-a", 1, "x", "forgot"), attempt("card-a", 2, "olá", "hard")])).toHaveLength(2);
    expect(() => validateFlashcardAnswers(cards, [attempt("card-a", 2, "olá", "good")])).toThrow("não correspondem ao baralho");
    expect(() => validateFlashcardAnswers(cards, [attempt("card-a", 1, "x", "forgot"), attempt("card-a", 2, "x", "hard"), attempt("card-a", 3, "x", "hard"), attempt("card-a", 4, "olá", "good")])).toThrow("entre uma e três");
  });

  it("keeps valid phrases and discards invalid items independently", () => {
    const words = [word("word-a", { display_text: "fui" }), word("word-b", { display_text: "mercado" })];
    const phrases = validateGeneratedPhrases([
      { text: "Ayer fui al mercado.", translation: "Ontem fui ao mercado.", word_ids: ["word-a", "word-b"] },
      { text: "fui fui ayer", translation: "repetida", word_ids: ["word-a"] },
      { text: "```json fui```", translation: "técnica", word_ids: ["word-a"] },
      { text: "Texto sem alvo", translation: "inválida", word_ids: ["word-b"] }
    ], words);
    expect([...phrases.keys()]).toEqual(["word-a"]);
    expect(phrases.get("word-a")?.supportingWordIds).toEqual(["word-b"]);
  });

  it("characterizes familiarity and due-date updates", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    expect(calculateLegacyWordReview(4, { correct: 1, wrong: 0 }, now)).toEqual({ familiarityScore: 5, reviewDueAt: "2026-07-17T12:00:00.000Z" });
    expect(calculateLegacyWordReview(9.8, { correct: 2, wrong: 0 }, now)).toEqual({ familiarityScore: 10, reviewDueAt: "2026-07-24T12:00:00.000Z" });
    expect(calculateLegacyWordReview(0.5, { correct: 0, wrong: 1 }, now)).toEqual({ familiarityScore: 0, reviewDueAt: "2026-07-11T12:00:00.000Z" });
  });
});

function activeCard(id: string, targetWordId: string, prompt: string, expectedAnswer: string) {
  return { id, sessionId: "session-a", type: "target_to_native" as const, targetWordId, supportingWordIds: [], prompt, expectedAnswer, acceptedAnswers: [], translation: expectedAnswer, difficulty: 1 };
}

function attempt(cardId: string, presentationNumber: number, userAnswer: string, rating: "forgot" | "hard" | "good" | "easy", forgot = false) {
  return { cardId, presentationNumber, userAnswer, rating, forgot, usedSpeech: false, responseTimeMs: 1000 };
}
