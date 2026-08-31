export const newWordsSessionSizes = [3, 5, 8] as const;
export type NewWordsSessionSize = (typeof newWordsSessionSizes)[number];

/** Frases por palavra nova. */
export const SENTENCES_PER_WORD = 3;
/** Limites de palavras lexicais por frase (spec: 2 a 6 palavras totais). */
export const NEW_WORDS_SENTENCE_MIN_WORDS = 2;
export const NEW_WORDS_SENTENCE_MAX_WORDS = 6;

export type TranslationVerdict = "correct" | "acceptable" | "minor_error" | "incorrect";

export type JudgedTranslation = {
  verdict: TranslationVerdict;
  /** Feedback do professor, em pt-BR (1–3 frases). */
  feedback: string;
  /** Tradução de referência (pode ser a do banco ou a correção da IA). */
  correctedTranslation: string;
  /** Tradução do aluno validada como sentido novo; ausente quando não há. */
  newSenseTranslation?: string;
};

export type NewWordPreview = {
  wordId: string;
  senseId: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
};

export type NewWordsSentence = {
  id: string;
  sessionId: string;
  targetWordId: string;
  targetSenseId: string;
  /** Frase no idioma alvo (o que o usuário vê e ouve). */
  sentence: string;
  /** Tradução de referência em pt-BR. */
  translation: string;
  audioText: string;
  position: number;
};

export type NewWordsAttemptResult = {
  sentenceId: string;
  clientAttemptId: string;
  judgment: JudgedTranslation;
  rating: "forgot" | "hard" | "good" | "easy";
  senseCreated: boolean;
};

export type NewWordsSessionResult = {
  score: number;
  wordCount: number;
  sentenceCount: number;
  correctSentences: number;
  firstAttemptCorrect: number;
  newSensesAdded: number;
  durationSeconds: number;
  words: NewWordPreview[];
};

export function normalizeNewWordsSessionSize(value: unknown): NewWordsSessionSize {
  return (newWordsSessionSizes as readonly unknown[]).includes(value) ? (value as NewWordsSessionSize) : 3;
}
