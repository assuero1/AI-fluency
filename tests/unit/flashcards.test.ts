import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeck,
  getCardTypeFlags,
  isFlashcardActiveRecallEnabled,
  normalizeFlashcardCount,
  normalizeFlashcardCriterion,
  normalizeFlashcardQueueKind,
  seededShuffle,
  selectFlashcardWords,
  validateFlashcardAnswers,
  validateGeneratedPhrases
} from "../../lib/learning/flashcards";
import type { WordFields } from "../../lib/learning/conversations";
import type { TeableRecord } from "../../lib/supabase/client";

// Force the AI phrase generation to fail so mixed-type buildDeck tests stay hermetic
// regardless of whether the environment has a working AI endpoint.
vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn(async () => { throw new Error("AI unavailable"); }) }));

function word(id: string, fields: Partial<WordFields>): TeableRecord<WordFields> {
  // Sense resolution (resolveDueSenses → synthesizeLegacySense) needs the scoping
  // fields and a lemma to build the synthetic sense key; production words always have them.
  return { id, fields: { user_id: "user-a", language_profile_id: "profile-a", lemma: id, ...fields } as WordFields };
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

  it("supports a server-side rollout kill switch", () => {
    const previous = process.env.FLASHCARD_ACTIVE_RECALL_ENABLED;
    process.env.FLASHCARD_ACTIVE_RECALL_ENABLED = "false";
    expect(isFlashcardActiveRecallEnabled()).toBe(false);
    process.env.FLASHCARD_ACTIVE_RECALL_ENABLED = "true";
    expect(isFlashcardActiveRecallEnabled()).toBe(true);
    if (previous === undefined) delete process.env.FLASHCARD_ACTIVE_RECALL_ENABLED;
    else process.env.FLASHCARD_ACTIVE_RECALL_ENABLED = previous;
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

  it("prioritizes due reviews and fills the deck with the closest upcoming ones", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const selected = selectFlashcardWords([
      word("due", { total_uses: 9, familiarity_score: 9, review_due_at: "2026-07-09T09:00:00.000Z" }),
      word("never-scheduled", { total_uses: 5, familiarity_score: 5 }),
      word("upcoming-near", { total_uses: 1, familiarity_score: 1, review_due_at: "2026-07-12T09:00:00.000Z" }),
      word("upcoming-far", { total_uses: 2, familiarity_score: 1, review_due_at: "2026-08-01T09:00:00.000Z" })
    ], "least_used", 3, now);

    expect(selected.map((item) => item.id)).toEqual(["never-scheduled", "due", "upcoming-near"]);
  });

  it("keeps the criterion ordering inside the due group", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const selected = selectFlashcardWords([
      word("due-frequent", { total_uses: 4, familiarity_score: 1, review_due_at: "2026-07-01T09:00:00.000Z" }),
      word("due-rare", { total_uses: 1, familiarity_score: 8, review_due_at: "2026-07-08T09:00:00.000Z" }),
      word("not-due", { total_uses: 0, familiarity_score: 0, review_due_at: "2026-07-11T09:00:00.000Z" })
    ], "least_used", 3, now);

    expect(selected.map((item) => item.id)).toEqual(["due-rare", "due-frequent", "not-due"]);
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
    const { phrases, rejectionReasons } = validateGeneratedPhrases([
      { text: "Ayer fui al mercado.", translation: "Ontem fui ao mercado.", word_ids: ["word-a", "word-b"] },
      { text: "fui fui ayer", translation: "repetida", word_ids: ["word-a"] },
      { text: "```json fui```", translation: "técnica", word_ids: ["word-a"] },
      { text: "Texto sem alvo", translation: "inválida", word_ids: ["word-b"] }
    ], words);
    expect([...phrases.keys()]).toEqual(["word-a"]);
    expect(phrases.get("word-a")?.supportingWordIds).toEqual(["word-b"]);
    expect(rejectionReasons).toEqual({ target_occurrences: 1, technical_tokens: 1, unknown_words: 1 });
  });
});

describe("flashcard queue kinds", () => {
  it("normalizes explicit queue kinds and rejects unknown values", () => {
    expect(normalizeFlashcardQueueKind("daily")).toBe("daily");
    expect(normalizeFlashcardQueueKind("custom")).toBe("custom");
    expect(normalizeFlashcardQueueKind("difficult")).toBe("difficult");
    expect(normalizeFlashcardQueueKind("weird")).toBeNull();
    expect(normalizeFlashcardQueueKind(undefined)).toBeNull();
  });
});

describe("card type rollout flags", () => {
  const ENV_KEYS = ["FLASHCARD_PRODUCTION_ENABLED", "FLASHCARD_CLOZE_ENABLED", "FLASHCARD_LISTENING_ENABLED"] as const;
  afterEach(() => { for (const key of ENV_KEYS) delete process.env[key]; });

  it("defaults every type to enabled", () => {
    expect(getCardTypeFlags()).toEqual({ production: true, cloze: true, listening: true });
  });

  it("disables a type only on the explicit value 'false'", () => {
    process.env.FLASHCARD_CLOZE_ENABLED = "false";
    process.env.FLASHCARD_LISTENING_ENABLED = "FALSE";
    process.env.FLASHCARD_PRODUCTION_ENABLED = "0";
    expect(getCardTypeFlags()).toEqual({ production: true, cloze: false, listening: false });
  });
});

describe("buildDeck with mixed types", () => {
  it("builds production cards from the translation when requested", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "house", review_state: "review" }),
      word("perro", { display_text: "perro", translation: "dog", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-1", ["native_to_target", "target_to_native"]);
    const production = deck.cards.find((card) => card.targetWordId === "casa")!;
    expect(production.type).toBe("native_to_target");
    expect(production.prompt).toBe("house");
    expect(production.expectedAnswer).toBe("casa");
    expect(production.acceptedAnswers).toEqual([]);
    const comprehension = deck.cards.find((card) => card.targetWordId === "perro")!;
    expect(comprehension.type).toBe("target_to_native");
    expect(comprehension.prompt).toBe("perro");
  }, 15_000);

  it("degrades cloze to deterministic types when no phrase validates", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "house", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-2", ["cloze"]);
    expect(["native_to_target", "target_to_native"]).toContain(deck.cards[0].type);
    expect(deck.adapted).toBe(true);
  }, 15_000);

  it("marks the deck as adapted when a non-cloze type falls back", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-3", ["native_to_target"]);
    expect(deck.cards[0].type).toBe("target_to_native");
    expect(deck.cards[0].generationSource).toBe("fallback");
    expect(deck.adapted).toBe(true);
    expect(deck.fallbacksByType).toEqual({ target_to_native: 1 });
  }, 15_000);
});

describe("buildDeck with word senses", () => {
  const banco = () => word("word-banco", { display_text: "banco", lemma: "banco", translation: "banco (assento)", review_state: "review" });
  const bancoSenses = () => new Map([["word-banco", [
    { id: "sense-seat", fields: { word_id: "word-banco", translation: "banco (assento)", review_due_at: "2026-08-20T09:00:00.000Z" } },
    { id: "sense-bank", fields: { word_id: "word-banco", translation: "banco (instituição)", review_due_at: "2026-08-01T09:00:00.000Z" } }
  ] as never[]]]);

  it("freezes the card for the most-due sense: its translation and targetSenseId", async () => {
    const deck = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-senses", ["native_to_target"], bancoSenses());

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]).toMatchObject({
      targetWordId: "word-banco",
      targetSenseId: "sense-bank",
      type: "native_to_target",
      prompt: "banco (instituição)",
      expectedAnswer: "banco",
      translation: "banco (instituição)"
    });
    expect(deck.cards[0].acceptedAnswers).toEqual([]);
  }, 15_000);

  it("uses the sense translation for comprehension cards and keeps lemma/display_text as accepted answers", async () => {
    const deck = await buildDeck([
      word("word-banco", { display_text: "banco", lemma: "banco", translation: "banco (assento)", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-senses-2", ["target_to_native"], bancoSenses());

    expect(deck.cards[0]).toMatchObject({
      targetSenseId: "sense-bank",
      type: "target_to_native",
      prompt: "banco",
      expectedAnswer: "banco (instituição)"
    });
  }, 15_000);

  it("keeps the legacy path for words without senses: word translation and no targetSenseId", async () => {
    const deck = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-legacy", ["native_to_target"]);

    expect(deck.cards[0]).toMatchObject({
      targetWordId: "word-banco",
      type: "native_to_target",
      prompt: "banco (assento)",
      translation: "banco (assento)"
    });
    expect(deck.cards[0].targetSenseId).toBeUndefined();
  }, 15_000);

  it("accepts the translations of the word's other senses on comprehension and listening cards", async () => {
    const comprehension = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-senses-accept", ["target_to_native"], bancoSenses());

    expect(comprehension.cards[0].type).toBe("target_to_native");
    expect(comprehension.cards[0].expectedAnswer).toBe("banco (instituição)");
    expect(comprehension.cards[0].acceptedAnswers).toEqual(["banco (assento)"]);

    const listening = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-senses-listen", ["listening"], bancoSenses());
    expect(listening.cards[0].type).toBe("listening");
    expect(listening.cards[0].acceptedAnswers).toEqual(["banco (assento)"]);
  }, 15_000);

  it("does not leak other senses into production card accepted answers", async () => {
    const deck = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-senses-prod", ["native_to_target"], bancoSenses());

    expect(deck.cards[0].type).toBe("native_to_target");
    expect(deck.cards[0].acceptedAnswers).toEqual([]);
  }, 15_000);

  it("marks multi-sense cards with the exercised sense position ordered by sense_order", async () => {
    const senses = new Map([["word-banco", [
      { id: "sense-bank", fields: { word_id: "word-banco", translation: "banco (instituição)", sense_order: 2, review_due_at: "2026-08-01T09:00:00.000Z" } },
      { id: "sense-seat", fields: { word_id: "word-banco", translation: "banco (assento)", sense_order: 1, review_due_at: "2026-08-20T09:00:00.000Z" } },
      { id: "sense-park", fields: { word_id: "word-banco", translation: "banco (praça)", sense_order: 3, review_due_at: "2026-08-25T09:00:00.000Z" } }
    ] as never[]]]);
    const deck = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-senses-pos", ["target_to_native"], senses);

    expect(deck.cards[0]).toMatchObject({ targetSenseId: "sense-bank", senseOrder: 2, senseCount: 3 });
  }, 15_000);

  it("omits the sense position on single-sense and legacy cards", async () => {
    const oneSense = new Map([["word-banco", [
      { id: "sense-seat", fields: { word_id: "word-banco", translation: "banco (assento)", sense_order: 1, review_due_at: "2026-08-01T09:00:00.000Z" } }
    ] as never[]]]);
    const single = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-single-sense", ["target_to_native"], oneSense);
    expect(single.cards[0].targetSenseId).toBe("sense-seat");
    expect(single.cards[0].senseOrder).toBeUndefined();
    expect(single.cards[0].senseCount).toBeUndefined();

    const legacy = await buildDeck([banco()], "Espanhol", "Intermediário (B1)", "seed-legacy-pos", ["target_to_native"]);
    expect(legacy.cards[0].targetSenseId).toBeUndefined();
    expect(legacy.cards[0].senseOrder).toBeUndefined();
    expect(legacy.cards[0].senseCount).toBeUndefined();
  }, 15_000);
});

function activeCard(id: string, targetWordId: string, prompt: string, expectedAnswer: string) {
  return { id, sessionId: "session-a", type: "target_to_native" as const, targetWordId, supportingWordIds: [], prompt, expectedAnswer, acceptedAnswers: [], translation: expectedAnswer, difficulty: 1 };
}

function attempt(cardId: string, presentationNumber: number, userAnswer: string, rating: "forgot" | "hard" | "good" | "easy", forgot = false) {
  return { cardId, presentationNumber, userAnswer, rating, forgot, usedSpeech: false, responseTimeMs: 1000 };
}
