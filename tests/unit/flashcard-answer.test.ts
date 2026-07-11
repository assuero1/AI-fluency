import { describe, expect, it } from "vitest";
import { compareFlashcardAnswer, normalizeFlashcardAnswer } from "../../lib/learning/flashcard-answer";

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
