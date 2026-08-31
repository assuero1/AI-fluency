// lib/learning/new-words-validation.ts
import { normalizeVocabularyToken, parseVocabularyForms } from "./vocabulary-selection";
import { allowedFunctionWords } from "./sentence-validation";

export type ProposedWord = { lemma: string; translation: string; partOfSpeech: string };
export type ExistingBankWord = { lemma: string; displayText: string; formsJson?: string };

/**
 * Filtra a proposta da IA: sem palavras do banco (lemma/display/formas),
 * sem function words (stopwords), sem duplicatas e sempre com tradução.
 * `count` limita o tamanho da sessão (3/5/8).
 */
export function validateProposedWords(items: unknown, existingWords: ExistingBankWord[], count: number): ProposedWord[] {
  if (!Array.isArray(items) || count < 1) return [];
  const taken = new Set(existingWords.flatMap((word) => [
    normalizeVocabularyToken(word.lemma || word.displayText),
    normalizeVocabularyToken(word.displayText),
    ...parseVocabularyForms(word.formsJson).map(normalizeVocabularyToken)
  ].filter(Boolean)));
  const result: ProposedWord[] = [];
  for (const item of items) {
    if (result.length >= count) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const lemma = typeof record.lemma === "string" ? record.lemma.trim() : "";
    const translation = typeof record.translation === "string" ? record.translation.trim() : "";
    if (!lemma || !translation) continue;
    const normalized = normalizeVocabularyToken(lemma);
    if (!normalized || taken.has(normalized) || allowedFunctionWords.has(normalized)) continue;
    taken.add(normalized);
    result.push({
      lemma,
      translation: translation.slice(0, 200),
      partOfSpeech: typeof record.part_of_speech === "string" ? record.part_of_speech.trim().slice(0, 60) : ""
    });
  }
  return result;
}
