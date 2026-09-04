export type WordRarity = "essential" | "native_expression" | "power_word";

export type RarityMeta = {
  rarity: WordRarity;
  label: string;
  emoji: string;
  badgeClass: string;
  description: string;
};

export const RARITY_DEFINITIONS: Record<WordRarity, RarityMeta> = {
  essential: {
    rarity: "essential",
    label: "Essencial",
    emoji: "🟢",
    badgeClass: "rarity-badge essential",
    description: "Vocabulário fundamental para conversação fluida."
  },
  native_expression: {
    rarity: "native_expression",
    label: "Expressão Nativa",
    emoji: "🔵",
    badgeClass: "rarity-badge native-expression",
    description: "Phrasal verbs, gírias e expressões do dia a dia nativo."
  },
  power_word: {
    rarity: "power_word",
    label: "Power Word",
    emoji: "🟣",
    badgeClass: "rarity-badge power-word",
    description: "Vocabulário avançado para refinamento e precisão."
  }
};

export function classifyWordRarity(word: {
  partOfSpeech?: string;
  lemma: string;
  translation?: string;
  frequencyRank?: number;
}): RarityMeta {
  const lemma = (word.lemma || "").trim().toLowerCase();
  const pos = (word.partOfSpeech || "").trim().toLowerCase();

  // Expressões Nativas: phrasal verbs, idioms, interjeições ou termos compostos
  if (
    pos === "phrasal_verb" ||
    pos === "idiom" ||
    pos === "interjection" ||
    pos === "expression" ||
    lemma.includes(" ") ||
    lemma.includes("-")
  ) {
    return RARITY_DEFINITIONS.native_expression;
  }

  // Power Words: conectivos, advérbios formais ou vocábulos com 9 ou mais caracteres
  if (
    pos === "adverb" ||
    pos === "conjunction" ||
    pos === "preposition" ||
    lemma.length >= 9
  ) {
    return RARITY_DEFINITIONS.power_word;
  }

  // Essencial: padrão para substantivos, verbos e adjetivos de uso frequente
  return RARITY_DEFINITIONS.essential;
}
