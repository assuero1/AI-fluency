export const flashcardCriteria = ["least_used", "oldest"] as const;
export type FlashcardCriterion = (typeof flashcardCriteria)[number];

export type FlashcardType = "target_to_native" | "native_to_target" | "cloze" | "listening";
export type AnswerMatch = "exact" | "acceptable" | "minor_error" | "incorrect" | "unknown";
export type RecallRating = "forgot" | "hard" | "good" | "easy";

export type QueueItem = {
  cardId: string;
  presentationNumber: number;
  dueAfterIndex: number;
};

export type Flashcard = {
  id: string;
  sessionId: string;
  type: FlashcardType;
  targetWordId: string;
  supportingWordIds: string[];
  prompt: string;
  expectedAnswer: string;
  acceptedAnswers: string[];
  translation: string;
  explanation?: string;
  sentence?: string;
  audioText?: string;
  difficulty: number;
  generationSource?: "ai" | "deterministic" | "fallback";
};

export type FlashcardAnswer = {
  clientAttemptId: string;
  cardId: string;
  presentationNumber: number;
  userAnswer: string;
  matchResult: AnswerMatch;
  suggestedRating: RecallRating;
  rating: RecallRating;
  forgot: boolean;
  usedSpeech: boolean;
  responseTimeMs: number;
  audioReplayCount?: number;
  usedSlowAudio?: boolean;
  answeredAfterAudioReplay?: boolean;
  audioFailed?: boolean;
};

export type CompleteFlashcardPracticeInput = {
  sessionId: string;
  clientCompletionId: string;
  answers: FlashcardAnswer[];
};

export type FlashcardPracticeResult = {
  score: number;
  correctCards: number;
  wrongCards: number;
  totalCards: number;
  reviewedWords: number;
  uniqueCardCount: number;
  presentationCount: number;
  firstAttemptCorrect: number;
  recoveredCards: number;
  firstAttemptAccuracy: number;
  eventualRecallAccuracy: number;
  productionAccuracy: number | null;
  comprehensionAccuracy: number | null;
  listeningAccuracy: number | null;
  averageResponseTimeMs: number;
  durationSeconds: number;
  difficultWords: number;
  slowWords: number;
};
