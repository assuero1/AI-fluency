// tests/unit/new-words-validation.test.ts
import { describe, expect, it } from "vitest";
import { validateProposedWords } from "../../lib/learning/new-words-validation";

const bank = [
  { lemma: "apple", displayText: "apple", formsJson: '["apples"]' },
  { lemma: "go", displayText: "go", formsJson: '["went","gone"]' }
];

describe("validateProposedWords", () => {
  it("aceita palavras inéditas com tradução", () => {
    const words = validateProposedWords(
      [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }],
      bank, 3
    );
    expect(words).toEqual([{ lemma: "bread", translation: "pão", partOfSpeech: "noun" }]);
  });

  it("rejeita palavra que já existe no banco (lemma, display ou forma)", () => {
    const words = validateProposedWords(
      [
        { lemma: "apple", translation: "maçã", part_of_speech: "noun" },
        { lemma: "went", translation: "foi", part_of_speech: "verb" },
        { lemma: "APPLES", translation: "maçãs", part_of_speech: "noun" },
        { lemma: "bread", translation: "pão", part_of_speech: "noun" }
      ],
      bank, 3
    );
    expect(words).toHaveLength(1);
    expect(words[0].lemma).toBe("bread");
  });

  it("rejeita stopword, sem tradução, duplicata e formato inválido", () => {
    const words = validateProposedWords(
      [
        { lemma: "the", translation: "o", part_of_speech: "article" },
        { lemma: "water", translation: "  ", part_of_speech: "noun" },
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        "lixo",
        { lemma: "", translation: "vazio" }
      ],
      bank, 5
    );
    expect(words.map((word) => word.lemma)).toEqual(["milk"]);
  });

  it("retorna no máximo `count` palavras", () => {
    const input = Array.from({ length: 10 }, (_, index) => ({ lemma: `word${index}`, translation: `p${index}`, part_of_speech: "noun" }));
    expect(validateProposedWords(input, bank, 3)).toHaveLength(3);
  });
});
