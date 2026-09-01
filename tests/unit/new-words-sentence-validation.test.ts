// tests/unit/new-words-sentence-validation.test.ts
import { describe, expect, it } from "vitest";
import { validateGeneratedSentences } from "../../lib/learning/new-words-validation";

const newWords = [{ id: "w1", lemma: "bread" }];
const known = ["eat", "i", "good", "want", "to"];

describe("validateGeneratedSentences", () => {
  it("aceita frases válidas de 2 a 6 palavras com o alvo uma vez", () => {
    const { sentencesByWord, droppedWordIds } = validateGeneratedSentences(
      [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ],
      newWords, known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(3);
    expect(droppedWordIds).toEqual([]);
  });

  it("aceita até SENTENCES_PER_WORD (6) frases por palavra e rejeita a sétima", () => {
    const { sentencesByWord, rejectionReasons } = validateGeneratedSentences(
      [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" },
        { text: "I want bread", translation: "eu quero pão", word: "bread" },
        { text: "i want to eat bread", translation: "eu quero comer pão", word: "bread" },
        { text: "want good bread", translation: "quero pão bom", word: "bread" },
        { text: "i eat good bread", translation: "eu como pão bom", word: "bread" }
      ],
      newWords, known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(6);
    expect(rejectionReasons.too_many_per_word).toBe(1);
  });

  it("rejeita frase longa, sem o alvo, com alvo duplicado e com desconhecidas demais", () => {
    const { sentencesByWord, rejectionReasons } = validateGeneratedSentences(
      [
        { text: "I want to eat fresh bread today now", translation: "x", word: "bread" }, // 7 palavras lexicais
        { text: "I eat rice", translation: "x", word: "bread" },                          // alvo ausente
        { text: "bread bread is good", translation: "x", word: "bread" },                 // alvo 2x
        { text: "bread zoqubit merval", translation: "x", word: "bread" },                // 2 desconhecidas
        { text: "bread is good", translation: "pão é bom", word: "bread" }                // válida
      ],
      newWords, known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(1);
    expect(rejectionReasons.too_many_words).toBe(1);
    expect(rejectionReasons.target_occurrences).toBe(2);
    expect(rejectionReasons.unknown_words).toBe(1);
  });

  it("descarta palavra que ficou sem frases e ignora palavra desconhecida da IA", () => {
    const { sentencesByWord, droppedWordIds } = validateGeneratedSentences(
      [{ text: "bread is good", translation: "pão é bom", word: "bread" }],
      [{ id: "w1", lemma: "bread" }, { id: "w2", lemma: "urgent" }],
      known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(1);
    expect(droppedWordIds).toEqual(["w2"]);
  });
});
