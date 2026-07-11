import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import { getEnv } from "@/lib/env";
import { LearningStateError } from "./access";
import { WordFields } from "./conversations";
import { getActiveLanguageProfile, getOrCreatePersonalUser } from "./profile";
import { matchesLearningScope } from "./scope";
import { compareAnswerForCard, normalizeFlashcardAnswer } from "./flashcard-answer";
import { isRatingCorrect, rebuildFlashcardQueue, suggestRecallRating } from "./flashcard-queue";
import { calculateAdaptiveReview, type ReviewAttempt } from "./spaced-repetition";
import {
  flashcardCriteria,
  type Flashcard,
  type FlashcardAnswer,
  type FlashcardCriterion,
  type RecallRating
} from "./flashcard-contracts";

export { flashcardCriteria } from "./flashcard-contracts";
export type { Flashcard, FlashcardCriterion } from "./flashcard-contracts";

export type PracticeSessionFields = {
  Name?: string;
  user_id: string;
  language_profile_id: string;
  conversation_id: string;
  type: string;
  focus: string;
  status?: "preparing" | "active" | "completed" | "abandoned" | "failed";
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  criterion?: string;
  requested_word_count?: number;
  selected_word_count?: number;
  unique_card_count?: number;
  presentation_count?: number;
  correct_count?: number;
  incorrect_count?: number;
  score?: number;
  language_code?: string;
  configuration_json?: string;
  parent_session_id?: string;
  created_at: string;
  updated_at?: string;
};

export type FlashcardFields = {
  practice_session_id: string;
  target_word_id: string;
  supporting_word_ids: string;
  card_type: Flashcard["type"];
  prompt: string;
  expected_answer: string;
  accepted_answers: string;
  translation: string;
  explanation: string;
  sentence: string;
  audio_text: string;
  difficulty: number;
  initial_position: number;
  generation_source: "ai" | "deterministic" | "fallback";
  created_at: string;
};

export type FlashcardAttemptFields = {
  practice_session_id: string;
  flashcard_id: string;
  word_id: string;
  presentation_number: number;
  client_attempt_id: string;
  user_answer: string;
  normalized_answer: string;
  match_result: string;
  suggested_rating: RecallRating;
  final_rating: RecallRating;
  was_correct: boolean;
  response_time_ms: number;
  used_speech: boolean;
  audio_replay_count: number;
  used_slow_audio?: boolean;
  answered_after_audio_replay?: boolean;
  audio_failed?: boolean;
  created_at: string;
};

type StoredFlashcardResult = {
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

type PracticeFocus = {
  criterion?: FlashcardCriterion;
  wordIds: string[];
  cardCount?: number;
  deckSeed?: string;
  cards?: Flashcard[];
  completed?: boolean;
  completionId?: string;
  result?: StoredFlashcardResult;
  [key: string]: unknown;
};

const completionLocks = new Map<string, Promise<StoredFlashcardResult>>();
const attemptLocks = new Map<string, Promise<PersistedAttempt>>();

type PersistedAttempt = ReturnType<typeof attemptRecordToAnswer> & { id: string };

export function normalizeFlashcardCriterion(value: unknown): FlashcardCriterion {
  return flashcardCriteria.includes(value as FlashcardCriterion) ? value as FlashcardCriterion : "least_used";
}

export function isFlashcardActiveRecallEnabled() {
  return getEnv("FLASHCARD_ACTIVE_RECALL_ENABLED")?.toLowerCase() !== "false";
}

export function normalizeFlashcardCount(value: unknown): number {
  return Math.max(2, Math.min(30, Math.round(Number(value) || 10)));
}

export function selectFlashcardWords<T extends TeableRecord<WordFields>>(words: T[], criterion: FlashcardCriterion, count: number): T[] {
  return [...words].sort(criterion === "least_used"
    ? (a, b) => Number(a.fields.total_uses ?? 0) - Number(b.fields.total_uses ?? 0) || Number(a.fields.familiarity_score ?? 0) - Number(b.fields.familiarity_score ?? 0)
    : (a, b) => dateValue(a.fields.last_used_at || a.fields.first_used_at) - dateValue(b.fields.last_used_at || b.fields.first_used_at))
    .slice(0, count);
}

export function getActiveRecallDistribution(wordCount: number, audioEnabled = false) {
  const count = Math.max(0, Math.floor(wordCount));
  if (count === 2) return { targetToNative: 1, nativeToTarget: 1, cloze: 0, listening: 0 };
  if (count === 3) return { targetToNative: 1, nativeToTarget: 1, cloze: 1, listening: 0 };
  const targetToNative = Math.round(count * 0.25);
  const listening = audioEnabled ? Math.round(count * 0.15) : 0;
  const cloze = Math.max(0, Math.round(count * 0.5) - listening);
  return { targetToNative, nativeToTarget: count - targetToNative - cloze - listening, cloze, listening };
}

export function validateFlashcardAnswers(cards: Flashcard[], answers: Array<{ cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; rating?: unknown; forgot?: unknown; usedSpeech?: unknown; responseTimeMs?: unknown }>) {
  if (answers.length < cards.length || answers.length > cards.length * 3) {
    throw new LearningStateError("A sessão deve conter entre uma e três apresentações por card.", 422);
  }
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const presentationCounts = new Map<string, number>();
  const validated = answers.map((answer) => {
    const cardId = typeof answer.cardId === "string" ? answer.cardId : "";
    const card = cardsById.get(cardId);
    const presentationNumber = Number(answer.presentationNumber);
    const expectedPresentation = (presentationCounts.get(cardId) ?? 0) + 1;
    const rating = isRecallRating(answer.rating) ? answer.rating : null;
    if (!card || !rating || presentationNumber !== expectedPresentation || presentationNumber > 3) {
      throw new LearningStateError("As respostas não correspondem ao baralho desta sessão.", 422);
    }
    const forgot = answer.forgot === true;
    const userAnswer = typeof answer.userAnswer === "string" ? answer.userAnswer.trim().slice(0, 300) : "";
    if (!forgot && !userAnswer) throw new LearningStateError("Informe uma resposta ou marque que não lembra.", 422);
    const matchResult = forgot ? "incorrect" as const : compareAnswerForCard(card, userAnswer);
    const responseTimeMs = Math.max(0, Math.min(300_000, Math.round(Number(answer.responseTimeMs) || 0)));
    presentationCounts.set(cardId, presentationNumber);
    return { cardId, presentationNumber, userAnswer, matchResult, rating, forgot, usedSpeech: answer.usedSpeech === true, responseTimeMs, wordIds: [card.targetWordId, ...card.supportingWordIds] };
  });
  if (cards.some((card) => !presentationCounts.has(card.id))) throw new LearningStateError("Todos os cards originais precisam ser apresentados.", 422);
  return validated;
}

export function calculateLegacyWordReview(currentFamiliarity: number, result: { correct: number; wrong: number }, now: Date) {
  const delta = result.correct - result.wrong * 1.5;
  const familiarity = Math.max(0, Math.min(10, Number(currentFamiliarity || 0) + delta));
  const reviewDays = result.wrong > 0 ? 1 : familiarity >= 8 ? 14 : familiarity >= 5 ? 7 : 3;
  return {
    familiarityScore: Math.round(familiarity * 10) / 10,
    reviewDueAt: new Date(now.getTime() + reviewDays * 86400000).toISOString()
  };
}

export async function createFlashcardPractice(input: { criterion?: unknown; count?: unknown; wordIds?: unknown; parentSessionId?: unknown; retrainMode?: unknown }) {
  const operationStartedAt = Date.now();
  if (!isFlashcardActiveRecallEnabled()) throw new LearningStateError("O treino de recuperação ativa ainda não está habilitado para este ambiente.", 503);
  const criterion = normalizeFlashcardCriterion(input.criterion);
  const requestedCount = normalizeFlashcardCount(input.count);
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Configure um idioma antes de iniciar o treino.", 409);
  const [allWords, sessions] = await Promise.all([
    client.listRecords<WordFields>("words", 500),
    client.listRecords<PracticeSessionFields>("practiceSessions", 300)
  ]);
  const active = sessions.find((session) => session.fields.user_id === user.id && session.fields.language_profile_id === profile.id && session.fields.type === "flashcards" && (session.fields.status === "active" || session.fields.status === "preparing"));
  if (active) throw new LearningStateError("Você já possui um treino ativo. Continue a sessão antes de iniciar outra.", 409);
  const scoped = allWords.filter((word) => matchesLearningScope(word.fields, { userId: user.id, profileId: profile.id }));
  const requestedWordIds = Array.isArray(input.wordIds) ? new Set(input.wordIds.filter((id): id is string => typeof id === "string")) : null;
  if (requestedWordIds && requestedWordIds.size > 30) throw new LearningStateError("O treino aceita no máximo 30 palavras.", 422);
  if (requestedWordIds && [...requestedWordIds].some((id) => !scoped.some((word) => word.id === id))) throw new LearningStateError("Uma ou mais palavras não pertencem ao perfil ativo.", 404);
  if (typeof input.parentSessionId === "string" && input.parentSessionId && !sessions.some((item) => item.id === input.parentSessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && item.fields.status === "completed")) throw new LearningStateError("Sessão de origem do retreino não encontrada.", 404);
  const selected = requestedWordIds?.size ? scoped.filter((word) => requestedWordIds.has(word.id)) : selectFlashcardWords(scoped, criterion, requestedCount);
  if (selected.length < 1) throw new LearningStateError("Salve pelo menos uma palavra antes de iniciar este treino.", 409);

  const now = new Date().toISOString();
  const session = await client.createRecord<PracticeSessionFields>("practiceSessions", {
    Name: `Flashcards · ${now.slice(0, 10)}`,
    user_id: user.id,
    language_profile_id: profile.id,
    conversation_id: "",
    type: "flashcards",
    focus: JSON.stringify({ criterion, wordIds: selected.map((word) => word.id), retrainMode: typeof input.retrainMode === "string" ? input.retrainMode : undefined }),
    status: "preparing",
    started_at: now,
    ended_at: "",
    duration_seconds: 0,
    criterion,
    requested_word_count: requestedCount,
    selected_word_count: selected.length,
    unique_card_count: 0,
    presentation_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    score: 0,
    language_code: profile.fields.language_code,
    configuration_json: JSON.stringify({ distribution: getActiveRecallDistribution(selected.length, profile.fields.audio_enabled === true) }),
    parent_session_id: typeof input.parentSessionId === "string" ? input.parentSessionId : "",
    created_at: now,
    updated_at: now
  });
  const deckSeed = crypto.randomUUID();
  let deck: Awaited<ReturnType<typeof buildDeck>>;
  let cards: Flashcard[];
  try {
    await client.createEvent(user.id, "flashcard_generation_started", { session_id: session.id, word_count: selected.length });
    deck = await buildDeck(selected, profile.fields.language_name || profile.fields.language_code, profile.fields.level || "intermediário", deckSeed, profile.fields.audio_enabled === true);
    cards = [];
    for (const [index, provisional] of deck.cards.entries()) {
      const record = await client.createRecord<FlashcardFields>("flashcards", flashcardToRecord(provisional, session.id, index, now));
      cards.push({ ...provisional, id: record.id, sessionId: session.id });
    }
    await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
      status: "active",
      unique_card_count: cards.length,
      configuration_json: JSON.stringify({ distribution: getActiveRecallDistribution(selected.length, profile.fields.audio_enabled === true), deckSeed, adapted: deck.adapted }),
      updated_at: new Date().toISOString()
    });
    await client.createEvent(user.id, "flashcard_generation_completed", { session_id: session.id, card_count: cards.length, duration_ms: Date.now() - operationStartedAt, fallback_used: deck.adapted });
  } catch (error) {
    await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, { status: "failed", updated_at: new Date().toISOString() }).catch(() => undefined);
    await client.createEvent(user.id, "flashcard_generation_failed", { session_id: session.id, duration_ms: Date.now() - operationStartedAt, error_type: safeErrorType(error) }).catch(() => undefined);
    throw error;
  }
  await client.createEvent(user.id, "flashcard_practice_started", { session_id: session.id, criterion, word_count: selected.length, card_count: cards.length });
  if (deck.adapted) await client.createEvent(user.id, "flashcard_generation_adapted", { session_id: session.id, requested_context_cards: getActiveRecallDistribution(selected.length, profile.fields.audio_enabled === true).cloze, generated_context_cards: cards.filter((card) => card.type === "cloze").length });
  return { sessionId: session.id, cards, languageCode: profile.fields.language_code, languageName: profile.fields.language_name, selectedWordCount: selected.length, adapted: deck.adapted };
}

export async function createFlashcardRetraining(sourceSessionId: string, mode: unknown) {
  const retrainMode = mode === "wrong" || mode === "difficult" || mode === "production" || mode === "listening" ? mode : null;
  if (!sourceSessionId.trim() || !retrainMode) throw new LearningStateError("Retreino inválido.", 422);
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const [sessions, words, cardRecords, attemptRecords] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<WordFields>("words", 500),
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000)
  ]);
  const source = sessions.find((session) => session.id === sourceSessionId && session.fields.user_id === user.id && session.fields.language_profile_id === profile.id && session.fields.type === "flashcards" && session.fields.status === "completed");
  if (!source) throw new LearningStateError("Sessão concluída não encontrada.", 404);
  const cards = cardRecords.filter((record) => record.fields.practice_session_id === source.id).map(flashcardRecordToCard);
  const attemptsByCard = new Map<string, FlashcardAnswer[]>();
  for (const record of attemptRecords.filter((item) => item.fields.practice_session_id === source.id).sort(compareAttemptRecords)) {
    const answer = attemptRecordToAnswer(record);
    attemptsByCard.set(answer.cardId, [...(attemptsByCard.get(answer.cardId) ?? []), answer]);
  }
  const difficultWords = new Set(words.filter((word) => matchesLearningScope(word.fields, { userId: user.id, profileId: profile.id }) && word.fields.review_state === "difficult").map((word) => word.id));
  const selectedCards = cards.filter((card) => {
    const attempts = attemptsByCard.get(card.id) ?? [];
    const final = attempts.at(-1);
    if (retrainMode === "wrong") return Boolean(final && !isRatingCorrect(final.rating));
    if (retrainMode === "difficult") return difficultWords.has(card.targetWordId) || attempts.some((attempt) => attempt.rating === "forgot" || attempt.rating === "hard");
    if (retrainMode === "production") return card.type === "native_to_target" || card.type === "cloze";
    return card.type === "listening";
  });
  const wordIds = [...new Set(selectedCards.flatMap((card) => [card.targetWordId, ...card.supportingWordIds]))];
  if (!wordIds.length) throw new LearningStateError("Não há palavras elegíveis para este retreino.", 409);
  const training = await createFlashcardPractice({ criterion: source.fields.criterion, count: wordIds.length, wordIds, parentSessionId: source.id, retrainMode });
  await client.createEvent(user.id, "flashcard_retraining_started", { session_id: training.sessionId, parent_session_id: source.id, mode: retrainMode, word_count: wordIds.length });
  return training;
}

export async function getActiveFlashcardPractice() {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const sessions = await client.listRecords<PracticeSessionFields>("practiceSessions", 300);
  const session = sessions
    .filter((item) => item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && item.fields.status === "active")
    .sort((a, b) => dateValue(b.fields.started_at || b.fields.created_at) - dateValue(a.fields.started_at || a.fields.created_at))[0];
  if (!session) return null;
  const [cardRecords, attemptRecords] = await Promise.all([
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000)
  ]);
  const cards = cardRecords.filter((record) => record.fields.practice_session_id === session.id).sort((a, b) => a.fields.initial_position - b.fields.initial_position).map(flashcardRecordToCard);
  const attempts = attemptRecords.filter((record) => record.fields.practice_session_id === session.id).sort(compareAttemptRecords).map((record) => ({ id: record.id, ...attemptRecordToAnswer(record) }));
  if (!cards.length) throw new LearningStateError("A sessão ativa não possui cards persistidos.", 409);
  const rebuilt = rebuildFlashcardQueue(cards, attempts);
  await client.createEvent(user.id, "flashcard_practice_resumed", { session_id: session.id, persisted_attempt_count: attempts.length });
  return {
    sessionId: session.id,
    cards,
    attempts,
    queue: rebuilt.queue,
    currentItem: rebuilt.currentItem,
    languageCode: session.fields.language_code || profile.fields.language_code,
    languageName: profile.fields.language_name,
    adapted: parseJson(session.fields.configuration_json).adapted === true,
    startedAt: session.fields.started_at || session.fields.created_at
  };
}

export async function abandonFlashcardPractice(sessionId: string) {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão de treino.", 422);
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const sessions = await client.listRecords<PracticeSessionFields>("practiceSessions", 300);
  const session = sessions.find((item) => item.id === sessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && (item.fields.status === "active" || item.fields.status === "preparing"));
  if (!session) throw new LearningStateError("Sessão ativa de treino não encontrada.", 404);
  const endedAt = new Date();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    status: "abandoned",
    ended_at: endedAt.toISOString(),
    duration_seconds: Math.max(0, Math.round((endedAt.getTime() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000)),
    updated_at: endedAt.toISOString()
  });
  await client.createEvent(user.id, "flashcard_practice_abandoned", { session_id: session.id });
  return { sessionId: session.id, status: "abandoned" as const };
}

export async function persistFlashcardAttempt(input: { sessionId?: unknown; clientAttemptId?: unknown; cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; rating?: unknown; forgot?: unknown; usedSpeech?: unknown; responseTimeMs?: unknown; audioReplayCount?: unknown; usedSlowAudio?: unknown; audioFailed?: unknown }) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const clientAttemptId = typeof input.clientAttemptId === "string" ? input.clientAttemptId : "";
  if (!sessionId || !isClientOperationId(clientAttemptId)) throw new LearningStateError("Identificador da tentativa inválido.", 422);
  const cardId = typeof input.cardId === "string" ? input.cardId : "";
  const presentationNumber = Number(input.presentationNumber);
  const lockKey = `${sessionId}:${cardId}:${presentationNumber}`;
  const pending = attemptLocks.get(lockKey);
  if (pending) {
    const existing = await pending;
    if (existing.clientAttemptId === clientAttemptId) return existing;
    throw new LearningStateError("Esta apresentação já está sendo salva por outra tentativa.", 409);
  }
  const operation = persistFlashcardAttemptUnlocked(sessionId, clientAttemptId, input);
  attemptLocks.set(lockKey, operation);
  try { return await operation; } finally { attemptLocks.delete(lockKey); }
}

async function persistFlashcardAttemptUnlocked(sessionId: string, clientAttemptId: string, input: { cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; rating?: unknown; forgot?: unknown; usedSpeech?: unknown; responseTimeMs?: unknown; audioReplayCount?: unknown; usedSlowAudio?: unknown; audioFailed?: unknown }) {
  const operationStartedAt = Date.now();
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const [sessions, cardRecords, attemptRecords] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && item.fields.status === "active");
  if (!session) throw new LearningStateError("Sessão ativa de treino não encontrada.", 404);
  const existing = attemptRecords.find((record) => record.fields.practice_session_id === sessionId && record.fields.client_attempt_id === clientAttemptId);
  if (existing) {
    await client.createEvent(user.id, "flashcard_duplicate_attempt_prevented", { session_id: sessionId, flashcard_id: existing.fields.flashcard_id, presentation_number: existing.fields.presentation_number });
    return { id: existing.id, ...attemptRecordToAnswer(existing) };
  }
  const cards = cardRecords.filter((record) => record.fields.practice_session_id === sessionId).sort((a, b) => a.fields.initial_position - b.fields.initial_position).map(flashcardRecordToCard);
  const priorAttempts = attemptRecords.filter((record) => record.fields.practice_session_id === sessionId).sort(compareAttemptRecords).map(attemptRecordToAnswer);
  const rebuilt = rebuildFlashcardQueue(cards, priorAttempts);
  const current = rebuilt.currentItem;
  const cardId = typeof input.cardId === "string" ? input.cardId : "";
  const presentationNumber = Number(input.presentationNumber);
  if (!current || current.cardId !== cardId || current.presentationNumber !== presentationNumber) {
    await client.createEvent(user.id, "flashcard_session_inconsistency", { session_id: sessionId, reason: "unexpected_queue_item", presentation_number: presentationNumber });
    throw new LearningStateError("A tentativa não corresponde ao próximo item da fila.", 409);
  }
  const card = cards.find((candidate) => candidate.id === cardId)!;
  const forgot = input.forgot === true;
  if (typeof input.userAnswer === "string" && input.userAnswer.length > 300) throw new LearningStateError("A resposta deve ter no máximo 300 caracteres.", 422);
  const userAnswer = typeof input.userAnswer === "string" ? input.userAnswer.trim() : "";
  if (!forgot && !userAnswer) throw new LearningStateError("Informe uma resposta ou marque que não lembra.", 422);
  const matchResult = forgot ? "incorrect" as const : compareAnswerForCard(card, userAnswer);
  const responseTimeMs = Math.max(0, Math.min(300_000, Math.round(Number(input.responseTimeMs) || 0)));
  const suggestedRating = suggestRecallRating({ match: matchResult, forgot, responseTimeMs, cardType: card.type });
  const rating = isRecallRating(input.rating) ? input.rating : suggestedRating;
  const now = new Date().toISOString();
  const record = await client.createRecord<FlashcardAttemptFields>("flashcardAttempts", {
    practice_session_id: sessionId,
    flashcard_id: card.id,
    word_id: card.targetWordId,
    presentation_number: presentationNumber,
    client_attempt_id: clientAttemptId,
    user_answer: userAnswer,
    normalized_answer: normalizeFlashcardAnswer(userAnswer),
    match_result: matchResult,
    suggested_rating: suggestedRating,
    final_rating: rating,
    was_correct: isRatingCorrect(rating),
    response_time_ms: responseTimeMs,
    used_speech: input.usedSpeech === true,
    audio_replay_count: Math.max(0, Math.min(30, Math.round(Number(input.audioReplayCount) || 0))),
    used_slow_audio: input.usedSlowAudio === true,
    answered_after_audio_replay: Number(input.audioReplayCount) > 0,
    audio_failed: input.audioFailed === true,
    created_at: now
  });
  await client.createEvent(user.id, "flashcard_attempt_evaluated", { session_id: sessionId, flashcard_id: card.id, presentation_number: presentationNumber, rating, match_result: matchResult, used_speech: input.usedSpeech === true, audio_replay_count: Math.max(0, Math.min(30, Math.round(Number(input.audioReplayCount) || 0))), audio_failed: input.audioFailed === true, evaluation_latency_ms: Date.now() - operationStartedAt });
  if (input.audioFailed === true) await client.createEvent(user.id, "flashcard_audio_fallback_activated", { session_id: sessionId, flashcard_id: card.id });
  await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, { presentation_count: priorAttempts.length + 1, updated_at: now });
  return { id: record.id, ...attemptRecordToAnswer(record) };
}

export async function completeFlashcardPractice(sessionId: string, clientCompletionId: string, answers: Array<{ cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; rating?: unknown; forgot?: unknown; usedSpeech?: unknown; responseTimeMs?: unknown }>) {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão de treino.", 422);
  if (!isClientOperationId(clientCompletionId)) throw new LearningStateError("Identificador de conclusão inválido.", 422);
  const pending = completionLocks.get(sessionId);
  if (pending) return pending;
  const operation = completeFlashcardPracticeUnlocked(sessionId, clientCompletionId, answers);
  completionLocks.set(sessionId, operation);
  try { return await operation; } finally { completionLocks.delete(sessionId); }
}

async function completeFlashcardPracticeUnlocked(sessionId: string, clientCompletionId: string, answers: Array<{ cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; rating?: unknown; forgot?: unknown; usedSpeech?: unknown; responseTimeMs?: unknown }>) {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const [sessions, words, cardRecords, attemptRecords] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<WordFields>("words", 500),
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards");
  if (!session) throw new LearningStateError("Sessão de treino não encontrada.", 404);
  const focus = parseFocus(session.fields.focus);
  if (focus.completed || session.fields.status === "completed") {
    if (focus.completionId === clientCompletionId && focus.result) return focus.result;
    await client.createEvent(user.id, "flashcard_duplicate_completion_blocked", { session_id: session.id });
    throw new LearningStateError("Este treino já foi contabilizado.", 409);
  }
  const persistedCards = cardRecords.filter((record) => record.fields.practice_session_id === session.id).sort((a, b) => a.fields.initial_position - b.fields.initial_position).map(flashcardRecordToCard);
  const cards = persistedCards.length ? persistedCards : focus.cards ?? [];
  if (!cards.length) throw new LearningStateError("Esta sessão não possui um baralho verificável. Inicie um novo treino.", 409);
  const persistedAttempts = attemptRecords.filter((record) => record.fields.practice_session_id === session.id).sort(compareAttemptRecords).map(attemptRecordToAnswer);
  const validatedAnswers = persistedAttempts.length
    ? persistedAttempts.map((answer) => ({ ...answer, wordIds: [cards.find((card) => card.id === answer.cardId)!.targetWordId, ...cards.find((card) => card.id === answer.cardId)!.supportingWordIds] }))
    : validateFlashcardAnswers(cards, answers.slice(0, 91));
  const rebuilt = rebuildFlashcardQueue(cards, validatedAnswers);
  if (rebuilt.currentItem) throw new LearningStateError("Ainda existem cards pendentes nesta sessão.", 409);
  const results = new Map<string, { correct: number; wrong: number }>();
  const reviewAttemptsByWord = new Map<string, ReviewAttempt[]>();
  for (const answer of validatedAnswers) {
    const card = cards.find((item) => item.id === answer.cardId);
    if (card?.type === "listening" && "audioFailed" in answer && answer.audioFailed) continue;
    for (const id of answer.wordIds) {
      const current = results.get(id) ?? { correct: 0, wrong: 0 };
      if (isRatingCorrect(answer.rating)) current.correct += 1;
      else current.wrong += 1;
      results.set(id, current);
      reviewAttemptsByWord.set(id, [...(reviewAttemptsByWord.get(id) ?? []), {
        rating: answer.rating,
        responseTimeMs: answer.responseTimeMs,
        cardType: card?.type
      }]);
    }
  }
  const now = new Date();
  for (const wordId of results.keys()) {
    const word = words.find((item) => item.id === wordId && matchesLearningScope(item.fields, { userId: user.id, profileId: profile.id }));
    if (!word) continue;
    const review = calculateAdaptiveReview(word.fields, reviewAttemptsByWord.get(wordId) ?? [], now, user.fields.timezone ?? "UTC");
    await client.updateRecord<WordFields>("words", word.id, {
      familiarity_score: review.familiarityScore,
      review_due_at: review.reviewDueAt,
      review_interval_days: review.reviewIntervalDays,
      review_ease: review.reviewEase,
      review_streak: review.reviewStreak,
      lapse_count: review.lapseCount,
      last_reviewed_at: review.lastReviewedAt,
      last_rating: review.lastRating,
      average_response_time_ms: review.averageResponseTimeMs,
      review_state: review.reviewState,
      review_version: review.reviewVersion
    });
  }
  const attemptsByCard = new Map<string, typeof validatedAnswers>();
  for (const answer of validatedAnswers) attemptsByCard.set(answer.cardId, [...(attemptsByCard.get(answer.cardId) ?? []), answer]);
  const finalAttempts = [...attemptsByCard.values()].map((attempts) => attempts.at(-1)!);
  const correctCards = finalAttempts.filter((answer) => isRatingCorrect(answer.rating)).length;
  const uniqueCardCount = cardsCount(cards);
  const presentationCount = validatedAnswers.length;
  const firstAttemptCorrect = validatedAnswers.filter((answer) => answer.presentationNumber === 1 && isRatingCorrect(answer.rating)).length;
  const recoveredCards = [...attemptsByCard.values()].filter((attempts) => !isRatingCorrect(attempts[0].rating) && isRatingCorrect(attempts.at(-1)!.rating)).length;
  const score = uniqueCardCount ? Math.round((correctCards / uniqueCardCount) * 100) : 0;
  const durationSeconds = Math.max(0, Math.round((now.getTime() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000));
  const accuracyFor = (types: Flashcard["type"][]) => {
    const scoped = finalAttempts.filter((answer) => types.includes(cards.find((card) => card.id === answer.cardId)?.type ?? "target_to_native"));
    return scoped.length ? Math.round((scoped.filter((answer) => isRatingCorrect(answer.rating)).length / scoped.length) * 100) : null;
  };
  const firstAttemptAccuracy = uniqueCardCount ? Math.round((firstAttemptCorrect / uniqueCardCount) * 100) : 0;
  const averageResponseTimeMs = presentationCount ? Math.round(validatedAnswers.reduce((sum, answer) => sum + answer.responseTimeMs, 0) / presentationCount) : 0;
  const difficultWords = [...results.keys()].filter((wordId) => words.find((word) => word.id === wordId)?.fields.review_state === "difficult").length;
  const slowWords = [...reviewAttemptsByWord.values()].filter((attempts) => attempts.some((attempt) => (attempt.responseTimeMs ?? 0) >= 8_000)).length;
  const result = { score, correctCards, wrongCards: uniqueCardCount - correctCards, totalCards: uniqueCardCount, reviewedWords: results.size, uniqueCardCount, presentationCount, firstAttemptCorrect, recoveredCards, firstAttemptAccuracy, eventualRecallAccuracy: score, productionAccuracy: accuracyFor(["native_to_target", "cloze"]), comprehensionAccuracy: accuracyFor(["target_to_native"]), listeningAccuracy: accuracyFor(["listening"]), averageResponseTimeMs, durationSeconds, difficultWords, slowWords };
  await client.createEvent(user.id, "flashcard_practice_completed", {
    session_id: session.id, correct_cards: correctCards, total_cards: uniqueCardCount, presentation_count: presentationCount, score,
    strong_word_ids: [...results].filter(([, value]) => value.correct > value.wrong).map(([id]) => id),
    weak_word_ids: [...results].filter(([, value]) => value.wrong >= value.correct).map(([id]) => id)
  });
  const endedAt = new Date();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    focus: JSON.stringify({ ...focus, cards: undefined, completed: true, completionId: clientCompletionId, score, result, completedAt: endedAt.toISOString() }),
    status: "completed",
    ended_at: endedAt.toISOString(),
    duration_seconds: durationSeconds,
    presentation_count: presentationCount,
    correct_count: correctCards,
    incorrect_count: uniqueCardCount - correctCards,
    score,
    updated_at: endedAt.toISOString()
  });
  return result;
}

export async function buildDeck(words: TeableRecord<WordFields>[], language: string, level: string, seed: string, audioEnabled: boolean) {
  const distribution = getActiveRecallDistribution(words.length, audioEnabled);
  const desiredTypes = [
    ...Array(distribution.targetToNative).fill("target_to_native" as const),
    ...Array(distribution.nativeToTarget).fill("native_to_target" as const),
    ...Array(distribution.cloze).fill("cloze" as const),
    ...Array(distribution.listening).fill("listening" as const)
  ];
  const phrases = await generatePhrases(words, language, level);
  const cards = words.map((word, index) => buildActiveRecallCard(word, desiredTypes[index] ?? "target_to_native", phrases.get(word.id), index));
  return { cards: seededShuffle(cards, seed), adapted: cards.filter((card) => card.type === "cloze").length < distribution.cloze };
}

type GeneratedPhrase = { text: string; translation: string; supportingWordIds: string[] };
type GeneratedPhraseInput = { text?: unknown; translation?: unknown; word_ids?: unknown };

export function validateGeneratedPhrases(items: GeneratedPhraseInput[], words: TeableRecord<WordFields>[]) {
  const generatedByWord = new Map<string, GeneratedPhrase>();
  const knownIds = new Set(words.map((word) => word.id));
  const vocabularyTokens = new Set(words.flatMap((word) => [word.fields.display_text, word.fields.lemma].filter(Boolean).flatMap((value) => lexicalTokens(value))));
  const seenSentences = new Set<string>();
  for (const item of items) {
    if (typeof item.text !== "string" || typeof item.translation !== "string" || !item.translation.trim()) continue;
    const text = item.text.trim();
    if (countLexicalWords(text) > 5 || /```|https?:\/\/|\b(?:json|id|translation|word_ids)\b/iu.test(text)) continue;
    const unknownLexicalWords = lexicalTokens(text).filter((token) => !vocabularyTokens.has(token) && !allowedFunctionWords.has(token));
    if (new Set(unknownLexicalWords).size > 1) continue;
    const normalizedSentence = text.toLocaleLowerCase();
    if (seenSentences.has(normalizedSentence)) continue;
    const ids = Array.isArray(item.word_ids) ? item.word_ids.filter((id): id is string => typeof id === "string" && knownIds.has(id)) : [];
    if (!ids.length || ids.length > 2) continue;
    const target = words.find((candidate) => candidate.id === ids[0]);
    if (!target || targetOccurrenceCount(text, targetText(target)) !== 1 || generatedByWord.has(target.id)) continue;
    generatedByWord.set(target.id, { text, translation: item.translation.trim(), supportingWordIds: ids.filter((id) => id !== target.id) });
    seenSentences.add(normalizedSentence);
  }
  return generatedByWord;
}

async function generatePhrases(words: TeableRecord<WordFields>[], language: string, level: string): Promise<Map<string, GeneratedPhrase>> {
  if (!words.length) return new Map();
  const vocabulary = words.map((word) => ({ id: word.id, word: word.fields.display_text || word.fields.lemma, translation: word.fields.translation }));
  try {
    const ai = await withTimeout(createChatCompletion([
      { role: "system", content: "Crie flashcards de frases naturais no idioma alvo e adequadas ao nível informado. Cada frase deve ter no máximo 5 palavras, uma única palavra-alvo e resposta não ambígua. Priorize exclusivamente o vocabulário fornecido; permita no máximo uma palavra lexical nova e use artigos, preposições, pronomes ou auxiliares extras quando indispensável. Em word_ids, coloque primeiro o ID da palavra-alvo e opcionalmente um único ID de apoio. Responda somente JSON válido no formato {\"phrases\":[{\"text\":\"...\",\"translation\":\"...\",\"word_ids\":[\"target-id\",\"optional-support-id\"]}]} e escreva translation em português brasileiro." },
      { role: "user", content: `Idioma: ${language}\nNível: ${level}\nCrie ${words.length} frases. Cada frase deve usar uma palavra principal diferente desta lista: ${JSON.stringify(vocabulary)}\nVocabulário disponível: ${JSON.stringify(vocabulary)}` }
    ], { temperature: 0.45, maxTokens: 1200 }), 8_000);
    const match = ai.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? "{}") as { phrases?: GeneratedPhraseInput[] };
    return validateGeneratedPhrases(parsed.phrases ?? [], words);
  } catch { /* deterministic word cards remain available */ }
  return new Map();
}

function buildActiveRecallCard(word: TeableRecord<WordFields>, desiredType: "target_to_native" | "native_to_target" | "cloze" | "listening", phrase: GeneratedPhrase | undefined, index: number): Flashcard {
  const target = targetText(word);
  const translation = word.fields.translation?.trim() || "";
  let type = desiredType;
  if (type === "native_to_target" && !translation) type = phrase ? "cloze" : "target_to_native";
  if (type === "cloze" && !phrase) type = translation ? "native_to_target" : "target_to_native";
  const prompt = type === "listening" ? "" : type === "native_to_target" ? translation : type === "cloze" && phrase ? replaceTargetWithBlank(phrase.text, target) : target;
  const expectedAnswer = type === "target_to_native" || type === "listening" ? translation || target : target;
  const acceptedAnswers = type === "target_to_native" || type === "listening"
    ? []
    : [word.fields.lemma, word.fields.display_text].filter((value, position, values): value is string => Boolean(value) && value !== expectedAnswer && values.indexOf(value) === position);
  return {
    id: `recall-${word.id}-${index}`,
    sessionId: "",
    type,
    targetWordId: word.id,
    supportingWordIds: phrase?.supportingWordIds ?? [],
    prompt,
    expectedAnswer,
    acceptedAnswers,
    translation: translation || phrase?.translation || "Tradução ainda não cadastrada",
    sentence: phrase?.text,
    audioText: type === "listening" ? target : undefined,
    difficulty: type === "cloze" || type === "native_to_target" ? 2 : type === "listening" ? 3 : 1,
    generationSource: type === "cloze" ? "ai" : desiredType !== type ? "fallback" : "deterministic"
  };
}

function parseFocus(value: string): PracticeFocus { try { const parsed = JSON.parse(value) as PracticeFocus; return { ...parsed, wordIds: Array.isArray(parsed.wordIds) ? parsed.wordIds.filter((id): id is string => typeof id === "string") : [], cards: Array.isArray(parsed.cards) ? parsed.cards.filter(isStoredFlashcard) : undefined }; } catch { return { wordIds: [] }; } }
function dateValue(value: string | undefined) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }
export function seededShuffle<T>(items: T[], seed: string) { const next = [...items]; let state = hashSeed(seed); for (let index = next.length - 1; index > 0; index -= 1) { state = (state * 1664525 + 1013904223) >>> 0; const swap = Math.floor((state / 4294967296) * (index + 1)); [next[index], next[swap]] = [next[swap], next[index]]; } return next; }
function hashSeed(seed: string) { let hash = 2166136261; for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function isClientOperationId(value: string) { return /^[a-zA-Z0-9_-]{8,100}$/.test(value); }
function isRecallRating(value: unknown): value is RecallRating { return value === "forgot" || value === "hard" || value === "good" || value === "easy"; }
function cardsCount(cards: Flashcard[] | undefined) { return cards?.length ?? 0; }
function targetText(word: TeableRecord<WordFields>) { return (word.fields.display_text || word.fields.lemma || "").trim(); }
function targetOccurrenceCount(sentence: string, target: string) { return [...sentence.matchAll(new RegExp(`(^|\\s|[.,;:!?¿¡])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡])`, "giu"))].length; }
function replaceTargetWithBlank(sentence: string, target: string) { return sentence.replace(new RegExp(`(^|\\s|[.,;:!?¿¡])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡])`, "iu"), (_match, prefix: string) => `${prefix}___`); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function countLexicalWords(value: string) { return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0; }
function lexicalTokens(value: string) { return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).map((token) => token.normalize("NFC")); }
const allowedFunctionWords = new Set("a an the to of in on at for with and or but i you he she it we they my your his her our their am is are was were be been do does did have has had o os as um uma uns umas de da do das dos em no na nos nas para por com e ou mas eu você ele ela nós vocês eles elas meu minha seu sua el la los las un una unos unas de del al en por para con y o pero yo tú usted él ella nosotros ustedes ellos ellas mi tu su es son era fue ser estar ha han haber".split(" "));
function withTimeout<T>(promise: Promise<T>, timeoutMs: number) { return new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Flashcard generation timed out.")), timeoutMs); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); }); }
function isStoredFlashcard(value: unknown): value is Flashcard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<Flashcard>;
  return typeof card.id === "string" && typeof card.sessionId === "string" && ["target_to_native", "native_to_target", "cloze", "listening"].includes(card.type ?? "") && typeof card.targetWordId === "string" && Array.isArray(card.supportingWordIds) && typeof card.prompt === "string" && typeof card.expectedAnswer === "string" && Array.isArray(card.acceptedAnswers) && typeof card.translation === "string" && typeof card.difficulty === "number";
}

function flashcardToRecord(card: Flashcard, sessionId: string, initialPosition: number, createdAt: string): FlashcardFields {
  return {
    practice_session_id: sessionId,
    target_word_id: card.targetWordId,
    supporting_word_ids: JSON.stringify(card.supportingWordIds),
    card_type: card.type,
    prompt: card.prompt,
    expected_answer: card.expectedAnswer,
    accepted_answers: JSON.stringify(card.acceptedAnswers),
    translation: card.translation,
    explanation: card.explanation ?? "",
    sentence: card.sentence ?? "",
    audio_text: card.audioText ?? "",
    difficulty: card.difficulty,
    initial_position: initialPosition,
    generation_source: card.generationSource ?? (card.type === "cloze" ? "ai" : "deterministic"),
    created_at: createdAt
  };
}

function flashcardRecordToCard(record: TeableRecord<FlashcardFields>): Flashcard {
  return {
    id: record.id,
    sessionId: record.fields.practice_session_id,
    type: record.fields.card_type,
    targetWordId: record.fields.target_word_id,
    supportingWordIds: parseStringArray(record.fields.supporting_word_ids),
    prompt: record.fields.prompt,
    expectedAnswer: record.fields.expected_answer,
    acceptedAnswers: parseStringArray(record.fields.accepted_answers),
    translation: record.fields.translation,
    explanation: record.fields.explanation || undefined,
    sentence: record.fields.sentence || undefined,
    audioText: record.fields.audio_text || undefined,
    difficulty: Number(record.fields.difficulty || 1),
    generationSource: record.fields.generation_source
  };
}

function attemptRecordToAnswer(record: TeableRecord<FlashcardAttemptFields>) {
  return {
    clientAttemptId: record.fields.client_attempt_id,
    cardId: record.fields.flashcard_id,
    presentationNumber: Number(record.fields.presentation_number),
    userAnswer: record.fields.user_answer,
    matchResult: record.fields.match_result as FlashcardAnswer["matchResult"],
    suggestedRating: record.fields.suggested_rating,
    rating: record.fields.final_rating,
    forgot: !record.fields.user_answer && record.fields.final_rating === "forgot",
    usedSpeech: Boolean(record.fields.used_speech),
    responseTimeMs: Number(record.fields.response_time_ms || 0),
    audioReplayCount: Number(record.fields.audio_replay_count || 0),
    usedSlowAudio: Boolean(record.fields.used_slow_audio),
    answeredAfterAudioReplay: Boolean(record.fields.answered_after_audio_replay),
    audioFailed: Boolean(record.fields.audio_failed)
  };
}

function compareAttemptRecords(a: TeableRecord<FlashcardAttemptFields>, b: TeableRecord<FlashcardAttemptFields>) {
  return dateValue(a.fields.created_at || a.createdTime) - dateValue(b.fields.created_at || b.createdTime) || a.id.localeCompare(b.id);
}

function parseStringArray(value: string | undefined) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function parseJson(value: string | undefined): Record<string, unknown> { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function safeErrorType(error: unknown) { return error instanceof LearningStateError ? `learning_state_${error.status}` : error instanceof Error ? error.name.slice(0, 80) : "unknown"; }
