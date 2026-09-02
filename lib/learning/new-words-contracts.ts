export const newWordsSessionSizes = [3, 5, 8] as const;
export type NewWordsSessionSize = (typeof newWordsSessionSizes)[number];

/** Frases por palavra nova (spec 2026-09-01: mais de 5). */
export const SENTENCES_PER_WORD = 6;
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

/** Sessão em preparação: o deck ainda está sendo gerado; o app faz polling do GET. */
export type PreparingNewWordsSession = { preparing: true; sessionId: string; requestedWordCount: number };

/** Falha recente na geração (últimos 10 minutos): a UI mostra erro acionável. */
export type FailedNewWordsSession = { preparing: false; failed: true; sessionId: string };

/** Sessão ativa pronta para jogar (mesmo payload de antes, com preparing: false). */
export type ReadyNewWordsSession = {
  preparing: false;
  failed?: false;
  sessionId: string;
  sentences: NewWordsSentence[];
  answeredCount: number;
  answeredSentenceIds: string[];
  nextSentenceId: string;
  languageCode: string;
  languageName: string;
  words: NewWordPreview[];
};

/** Payload de activeSession no GET /api/practice/new-words (null = nada em andamento). */
export type ActiveNewWordsPractice = PreparingNewWordsSession | FailedNewWordsSession | ReadyNewWordsSession;

export function normalizeNewWordsSessionSize(value: unknown): NewWordsSessionSize {
  return (newWordsSessionSizes as readonly unknown[]).includes(value) ? (value as NewWordsSessionSize) : 3;
}

/** Separa a frase na ocorrência inteira da palavra-alvo (case-insensitive) para destaque na UI. */
export function splitSentenceAroundTarget(sentence: string, lemma: string): { before: string; match: string; after: string } | null {
  const trimmedLemma = lemma.trim();
  if (!trimmedLemma) return null;
  const pattern = new RegExp(`(^|\\s|[.,;:!?¿¡])${trimmedLemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|[.,;:!?¿¡])`, "iu");
  const found = sentence.match(pattern);
  if (!found || found.index === undefined) return null;
  const leading = found[1] ?? "";
  const matchStart = found.index + leading.length;
  const matchEnd = matchStart + found[0].length - leading.length;
  return {
    before: sentence.slice(0, matchStart),
    match: sentence.slice(matchStart, matchEnd),
    after: sentence.slice(matchEnd)
  };
}
