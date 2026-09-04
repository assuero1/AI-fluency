import { describe, expect, it } from "vitest";
import { classifyWordRarity } from "@/lib/learning/word-rarity";

describe("word-rarity", () => {
  it("classifica termos curtos do dia a dia como essenciais", () => {
    expect(classifyWordRarity({ lemma: "water", partOfSpeech: "noun" }).rarity).toBe("essential");
    expect(classifyWordRarity({ lemma: "talk", partOfSpeech: "verb" }).rarity).toBe("essential");
    expect(classifyWordRarity({ lemma: "happy", partOfSpeech: "adjective" }).rarity).toBe("essential");
  });

  it("classifica expressões, termos compostos e phrasal verbs como expressões nativas", () => {
    expect(classifyWordRarity({ lemma: "figure out", partOfSpeech: "verb" }).rarity).toBe("native_expression");
    expect(classifyWordRarity({ lemma: "give-up", partOfSpeech: "verb" }).rarity).toBe("native_expression");
    expect(classifyWordRarity({ lemma: "by the way", partOfSpeech: "idiom" }).rarity).toBe("native_expression");
    expect(classifyWordRarity({ lemma: "hangout", partOfSpeech: "phrasal_verb" }).rarity).toBe("native_expression");
  });

  it("classifica palavras longas, advérbios e conjunções como power words", () => {
    expect(classifyWordRarity({ lemma: "overwhelmed", partOfSpeech: "adjective" }).rarity).toBe("power_word");
    expect(classifyWordRarity({ lemma: "nevertheless", partOfSpeech: "adverb" }).rarity).toBe("power_word");
    expect(classifyWordRarity({ lemma: "consequently", partOfSpeech: "conjunction" }).rarity).toBe("power_word");
    expect(classifyWordRarity({ lemma: "resilience", partOfSpeech: "noun" }).rarity).toBe("power_word");
  });
});
