import type { AnswerMatch, Flashcard } from "./flashcard-contracts";

const peripheralPunctuation = /^[\s.,;:!?¿¡()[\]{}"“”«»…-]+|[\s.,;:!?¿¡()[\]{}"“”«»…-]+$/gu;
const apostrophes = /[’‘`´]/g;
const articles = new Set(["a", "an", "the", "o", "a", "os", "as", "um", "uma", "unos", "unas", "el", "la", "los", "las", "un", "una"]);

export function normalizeFlashcardAnswer(value: string): string {
  return value
    .normalize("NFC")
    .replace(apostrophes, "'")
    .trim()
    .toLocaleLowerCase()
    .replace(peripheralPunctuation, "")
    .replace(/\s+/g, " ");
}

export function compareFlashcardAnswer(input: string, expected: string, acceptedAnswers: string[] = []): AnswerMatch {
  const normalizedInput = normalizeFlashcardAnswer(input);
  const normalizedExpected = normalizeFlashcardAnswer(expected);
  if (!normalizedInput) return "incorrect";
  if (normalizedInput === normalizedExpected) return "exact";
  if (acceptedAnswers.some((answer) => normalizeFlashcardAnswer(answer) === normalizedInput)) return "acceptable";
  if (stripDiacritics(normalizedInput) === stripDiacritics(normalizedExpected)) return "minor_error";
  if (withoutLeadingArticle(normalizedInput) === withoutLeadingArticle(normalizedExpected)) return "minor_error";
  if (normalizedInput.includes(" ") || normalizedExpected.includes(" ")) return "unknown";
  return "incorrect";
}

export function compareAnswerForCard(card: Flashcard, input: string): AnswerMatch {
  return compareFlashcardAnswer(input, card.expectedAnswer, card.acceptedAnswers);
}

export function isAutomaticCorrect(match: AnswerMatch): boolean {
  return match === "exact" || match === "acceptable";
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function withoutLeadingArticle(value: string) {
  const words = value.split(" ");
  return articles.has(words[0]) ? words.slice(1).join(" ") : value;
}
