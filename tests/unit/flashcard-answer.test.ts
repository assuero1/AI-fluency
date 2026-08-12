import { describe, expect, it } from "vitest";
import { compareAnswerForCard, compareFlashcardAnswer, normalizeFlashcardAnswer } from "../../lib/learning/flashcard-answer";
import type { Flashcard } from "../../lib/learning/flashcard-contracts";

describe("flashcard answer normalization", () => {
  it("normalizes NFC, case, whitespace, punctuation, and apostrophes", () => {
    expect(normalizeFlashcardAnswer("  ¡HOLA,   MUNDO! ")).toBe("hola, mundo");
    expect(normalizeFlashcardAnswer("L’AMOUR")).toBe("l'amour");
    expect(normalizeFlashcardAnswer("si\u0301")).toBe("sí");
  });

  it("distinguishes exact and registered alternatives", () => {
    expect(compareFlashcardAnswer("Hola", "hola")).toBe("exact");
    expect(compareFlashcardAnswer("qué tal", "cómo estás", ["¿Qué tal?"])).toBe("acceptable");
  });

  it("treats missing accents and articles as minor errors", () => {
    expect(compareFlashcardAnswer("si", "sí")).toBe("minor_error");
    expect(compareFlashcardAnswer("mercado", "el mercado")).toBe("minor_error");
  });

  it("keeps clear single-word errors deterministic and open phrases reviewable", () => {
    expect(compareFlashcardAnswer("perro", "gato")).toBe("incorrect");
    expect(compareFlashcardAnswer("yo fui", "yo voy")).toBe("unknown");
  });
});

describe("multi-sense accepted answers", () => {
  const senseCard: Flashcard = {
    id: "card-sense",
    sessionId: "session-a",
    type: "target_to_native",
    targetWordId: "word-banco",
    targetSenseId: "sense-bank",
    supportingWordIds: [],
    prompt: "banco",
    expectedAnswer: "banco (instituição)",
    acceptedAnswers: ["banco (assento)"],
    translation: "banco (instituição)",
    difficulty: 1
  };

  it("accepts another sense's translation as a registered alternative on sense-frozen cards", () => {
    expect(compareAnswerForCard(senseCard, "banco (instituição)")).toBe("exact");
    expect(compareAnswerForCard(senseCard, "banco (assento)")).toBe("acceptable");
  });

  it("would leave the other sense's translation reviewable without the registered alternatives", () => {
    expect(compareAnswerForCard({ ...senseCard, acceptedAnswers: [] }, "banco (assento)")).toBe("unknown");
  });
});
