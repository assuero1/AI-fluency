// lib/learning/new-words-validation.ts
import { normalizeVocabularyToken, parseVocabularyForms } from "./vocabulary-selection";
import { NEW_WORDS_SENTENCE_MAX_WORDS, NEW_WORDS_SENTENCE_MIN_WORDS, SENTENCES_PER_WORD } from "./new-words-contracts";
import { allowedFunctionWords, countLexicalWords, lexicalTokens, targetOccurrenceCount } from "./sentence-validation";
import type { AnswerMatch } from "./flashcard-contracts";
import { compareFlashcardAnswer } from "./flashcard-answer";
import type { JudgedTranslation, TranslationVerdict } from "./new-words-contracts";

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

export type GeneratedSentence = { text: string; translation: string };

/**
 * Valida as frases geradas pela IA contra o repertório do aluno: tamanho
 * 2–6 palavras lexicais, alvo presente exatamente 1×, no máximo 1 token
 * lexical fora do vocabulário conhecido + function words (escapatória para
 * flexões), sem duplicatas, no máximo SENTENCES_PER_WORD por palavra.
 */
export function validateGeneratedSentences(
  items: unknown,
  newWords: Array<{ id: string; lemma: string }>,
  knownWords: string[]
) {
  const sentencesByWord = new Map<string, GeneratedSentence[]>();
  const droppedWordIds: string[] = [];
  const rejectionReasons: Record<string, number> = {};
  const reject = (reason: string) => { rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1; };
  if (!Array.isArray(items)) return { sentencesByWord, droppedWordIds, rejectionReasons };

  const knownTokens = new Set(knownWords.flatMap((word) => lexicalTokens(word)));
  const targetByLemma = new Map(newWords.map((word) => [normalizeVocabularyTokenSafe(word.lemma), word]));
  const seenSentences = new Set<string>();
  const perWordCount = new Map<string, number>();

  for (const item of items) {
    if (!item || typeof item !== "object") { reject("invalid_shape"); continue; }
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const translation = typeof record.translation === "string" ? record.translation.trim() : "";
    const lemma = typeof record.word === "string" ? normalizeVocabularyTokenSafe(record.word) : "";
    const target = targetByLemma.get(lemma);
    if (!text || !translation || !target) { reject("invalid_shape"); continue; }
    const lexicalCount = countLexicalWords(text);
    if (lexicalCount < NEW_WORDS_SENTENCE_MIN_WORDS || lexicalCount > NEW_WORDS_SENTENCE_MAX_WORDS) { reject("too_many_words"); continue; }
    if (/```|https?:\/\/|\b(?:json|translation)\b/iu.test(text)) { reject("technical_tokens"); continue; }
    if (targetOccurrenceCount(text, target.lemma) !== 1) { reject("target_occurrences"); continue; }
    const targetTokens = new Set(lexicalTokens(target.lemma));
    const unknown = lexicalTokens(text).filter((token) =>
      !knownTokens.has(token) && !targetTokens.has(token) && !allowedFunctionWords.has(token)
    );
    if (new Set(unknown).size > 1) { reject("unknown_words"); continue; }
    const normalizedSentence = text.toLocaleLowerCase();
    if (seenSentences.has(normalizedSentence)) { reject("duplicate"); continue; }
    if ((perWordCount.get(target.id) ?? 0) >= SENTENCES_PER_WORD) { reject("too_many_per_word"); continue; }
    seenSentences.add(normalizedSentence);
    perWordCount.set(target.id, (perWordCount.get(target.id) ?? 0) + 1);
    sentencesByWord.set(target.id, [...(sentencesByWord.get(target.id) ?? []), { text, translation }]);
  }
  for (const word of newWords) {
    if (!sentencesByWord.get(word.id)?.length) droppedWordIds.push(word.id);
  }
  return { sentencesByWord, droppedWordIds, rejectionReasons };
}

function normalizeVocabularyTokenSafe(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const translationVerdicts: TranslationVerdict[] = ["correct", "acceptable", "minor_error", "incorrect"];

export function mapVerdictToMatch(verdict: TranslationVerdict): AnswerMatch {
  if (verdict === "correct") return "exact";
  return verdict;
}

export function sanitizeJudgment(value: unknown, referenceTranslation: string): JudgedTranslation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const verdict = translationVerdicts.find((candidate) => candidate === record.verdict);
  if (!verdict) return null;
  const rawFeedback = typeof record.feedback === "string" ? record.feedback.trim() : "";
  const corrected = typeof record.corrected_translation === "string" && record.corrected_translation.trim()
    ? record.corrected_translation.trim()
    : referenceTranslation;
  const newSense = typeof record.new_sense_translation === "string" && record.new_sense_translation.trim()
    ? record.new_sense_translation.trim().slice(0, 200)
    : undefined;
  return {
    verdict,
    feedback: (rawFeedback || feedbackFallback(verdict)).slice(0, 300),
    correctedTranslation: corrected,
    // Sentido novo só faz sentido quando o aluno acertou.
    ...(verdict === "correct" || verdict === "acceptable" ? { newSenseTranslation: newSense } : {})
  };
}

function feedbackFallback(verdict: TranslationVerdict) {
  if (verdict === "incorrect") return "Ainda não é essa a tradução. Veja a tradução esperada e vamos para a próxima.";
  if (verdict === "minor_error") return "Quase isso! Confira os detalhes na tradução esperada.";
  return "Isso mesmo!";
}

export function fallbackJudgment(userTranslation: string, referenceTranslation: string): JudgedTranslation {
  const match = compareFlashcardAnswer(userTranslation, referenceTranslation);
  const verdict: TranslationVerdict = match === "exact" || match === "acceptable" ? "correct"
    : match === "minor_error" ? "minor_error"
    : "incorrect";
  return { verdict, feedback: feedbackFallback(verdict), correctedTranslation: referenceTranslation };
}
