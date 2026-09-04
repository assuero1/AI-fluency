import { describe, expect, it } from "vitest";
import {
  detectHuntWordsInMessage,
  parseHuntWords,
  selectHuntWords,
  type HuntWord
} from "@/lib/learning/word-hunting";
import type { TeableClient, TeableRecord } from "@/lib/supabase/client";
import type { WordFields } from "@/lib/learning/conversations";

describe("word-hunting: detectHuntWordsInMessage", () => {
  const huntWords: HuntWord[] = [
    {
      wordId: "w1",
      lemma: "overwhelmed",
      translation: "sobrecarregado",
      forms: ["overwhelming"]
    },
    {
      wordId: "w2",
      lemma: "figure out",
      translation: "compreender / resolver",
      forms: ["figured out", "figuring out"]
    },
    {
      wordId: "w3",
      lemma: "run",
      translation: "correr",
      forms: ["ran"]
    }
  ];

  it("detecta lemma exato com word boundary", () => {
    const found = detectHuntWordsInMessage("I feel overwhelmed with work.", huntWords);
    expect(found.map((w) => w.lemma)).toEqual(["overwhelmed"]);
  });

  it("detecta forma flexionada", () => {
    const found = detectHuntWordsInMessage("I am figuring out what to do.", huntWords);
    expect(found.map((w) => w.lemma)).toEqual(["figure out"]);
  });

  it("ignora substrings parciais", () => {
    // 'running' não está em forms de 'run'
    const found = detectHuntWordsInMessage("I am running away.", huntWords);
    expect(found).toEqual([]);
  });

  it("é case-insensitive e tolera pontuação", () => {
    const found = detectHuntWordsInMessage("OVERWHELMED! Did you hear that?", huntWords);
    expect(found.map((w) => w.lemma)).toEqual(["overwhelmed"]);
  });

  it("retorna múltiplas palavras quando presentes na mesma mensagem", () => {
    const found = detectHuntWordsInMessage(
      "I was overwhelmed, but then I ran and figured out a solution.",
      huntWords
    );
    expect(found.map((w) => w.lemma).sort()).toEqual(["figure out", "overwhelmed", "run"].sort());
  });
});

describe("word-hunting: selectHuntWords", () => {
  const mockWords: TeableRecord<WordFields>[] = [
    {
      id: "word-1",
      fields: {
        lemma: "learning-word",
        translation: "palavra em aprendizado",
        review_state: "learning",
        forms_json: "[\"learning-word-form\"]"
      } as WordFields
    },
    {
      id: "word-2",
      fields: {
        lemma: "difficult-word",
        translation: "palavra difícil",
        review_state: "difficult",
        forms_json: "[]"
      } as WordFields
    },
    {
      id: "word-3",
      fields: {
        lemma: "suspended-word",
        translation: "palavra suspensa",
        review_state: "suspended",
        forms_json: "[]"
      } as WordFields
    }
  ];

  const mockClient = {
    listRecordsWhereAll: async () => mockWords
  } as unknown as TeableClient;

  it("prioriza palavras em estado learning e difficult, excluindo suspended", async () => {
    const selected = await selectHuntWords(mockClient, "u1", "p1", { count: 2 });
    expect(selected.length).toBe(2);
    expect(selected[0].wordId).toBe("word-1");
    expect(selected[1].wordId).toBe("word-2");
  });

  it("respeita specificWordIds se fornecido", async () => {
    const selected = await selectHuntWords(mockClient, "u1", "p1", {
      specificWordIds: ["word-2"]
    });
    expect(selected.length).toBe(1);
    expect(selected[0].wordId).toBe("word-2");
  });
});

describe("word-hunting: parseHuntWords", () => {
  it("trata array, string JSON e valores nulos graciosamente", () => {
    expect(parseHuntWords(null)).toEqual([]);
    expect(parseHuntWords("")).toEqual([]);
    expect(parseHuntWords("[{\"wordId\":\"w1\",\"lemma\":\"test\"}]")).toHaveLength(1);
  });
});
