import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: {} };
const profile = { id: "profile-a", fields: { language_code: "es", language_name: "Espanhol" } };
const session = { id: "session-a", fields: { user_id: user.id, language_profile_id: profile.id, type: "flashcards", status: "active", language_code: "es", focus: "{}", configuration_json: "{}", started_at: "2026-07-10T12:00:00.000Z", created_at: "2026-07-10T12:00:00.000Z" } };
const cardRecord = { id: "card-a", fields: { practice_session_id: session.id, target_word_id: "word-a", supporting_word_ids: "[]", card_type: "native_to_target", prompt: "olá", expected_answer: "hola", accepted_answers: "[]", translation: "olá", explanation: "", sentence: "", audio_text: "", difficulty: 2, initial_position: 0, generation_source: "deterministic", created_at: "2026-07-10T12:00:00.000Z" } };
let attempts: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }> = [];
const listRecords = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const createEvent = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/learning/profile", () => ({
  getOrCreatePersonalUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, createRecord, updateRecord, createEvent })
}));

describe("flashcard attempt persistence and resume", () => {
  beforeEach(() => {
    attempts = [];
    vi.clearAllMocks();
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      return [];
    });
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      if (table !== "flashcardAttempts") throw new Error(`Unexpected table: ${table}`);
      const record = { id: `attempt-${attempts.length + 1}`, fields, createdTime: fields.created_at as string };
      attempts.push(record);
      return record;
    });
    updateRecord.mockResolvedValue(session);
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("persists one normalized attempt and returns it idempotently", async () => {
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const input = { sessionId: session.id, clientAttemptId: "attempt-client-001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "  HOLA  ", rating: "hard", forgot: false, usedSpeech: true, responseTimeMs: 2400, audioReplayCount: 2, usedSlowAudio: true, audioFailed: false };
    const first = await persistFlashcardAttempt(input);
    const second = await persistFlashcardAttempt(input);

    expect(first).toMatchObject({ id: "attempt-1", clientAttemptId: "attempt-client-001", cardId: cardRecord.id, presentationNumber: 1, matchResult: "exact", suggestedRating: "easy", rating: "hard", usedSpeech: true, audioReplayCount: 2, usedSlowAudio: true, answeredAfterAudioReplay: true, audioFailed: false });
    expect(second).toEqual(first);
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(attempts[0].fields.normalized_answer).toBe("hola");
    expect(attempts[0].fields).toMatchObject({ audio_replay_count: 2, used_slow_audio: true, answered_after_audio_replay: true, audio_failed: false });
    expect(createEvent).toHaveBeenCalledWith(user.id, "flashcard_attempt_evaluated", expect.objectContaining({ session_id: session.id, presentation_number: 1, evaluation_latency_ms: expect.any(Number) }));
    expect(createEvent).toHaveBeenCalledWith(user.id, "flashcard_duplicate_attempt_prevented", expect.objectContaining({ session_id: session.id, presentation_number: 1 }));
  });

  it("applies the SRS update incrementally and marks the attempt as applied", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } }];
      return [];
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-002", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "hard", forgot: false, responseTimeMs: 2400 });

    expect(updateRecord).toHaveBeenCalledWith("words", "word-a", expect.objectContaining({
      review_version: "srs-v2", review_state: "learning", learning_step: 0, review_ease: 2.22, familiarity_score: 3.5
    }));
    expect(updateRecord).toHaveBeenCalledWith("flashcardAttempts", "attempt-1", expect.objectContaining({ review_applied: true, resulting_review_state: "learning" }));
  });

  it("keeps the attempt unapplied when the incremental SRS write fails", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } }];
      return [];
    });
    updateRecord.mockImplementation(async (table: string) => {
      if (table === "words") throw new Error("teable down");
      return session;
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-003", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "hard", forgot: false, responseTimeMs: 2400 });

    expect(result.id).toBe("attempt-1");
    expect(createEvent).toHaveBeenCalledWith(user.id, "flashcard_incremental_review_failed", expect.objectContaining({ session_id: session.id }));
    expect(updateRecord.mock.calls.filter(([table]) => table === "flashcardAttempts")).toHaveLength(0);
  });

  it("skips the incremental SRS update for listening attempts with audio failure", async () => {
    const listeningCard = { ...cardRecord, fields: { ...cardRecord.fields, card_type: "listening" } };
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [listeningCard];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } }];
      return [];
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-004", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "good", forgot: false, responseTimeMs: 2400, audioFailed: true });

    expect(updateRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
    expect(updateRecord.mock.calls.filter(([table]) => table === "flashcardAttempts")).toHaveLength(0);
  });

  it("does not fail the attempt when failure telemetry also fails", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } }];
      return [];
    });
    updateRecord.mockImplementation(async (table: string) => {
      if (table === "words") throw new Error("teable down");
      return session;
    });
    createEvent.mockImplementation(async (_userId: string, name: string) => {
      if (name === "flashcard_incremental_review_failed") throw new Error("events down");
      return { id: "event-a", fields: {} };
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-005", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "hard", forgot: false, responseTimeMs: 2400 });

    expect(result.id).toBe("attempt-1");
  });

  it("reconstructs the next presentation from persisted history", async () => {
    const { getActiveFlashcardPractice, persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "hard", forgot: false, responseTimeMs: 2000 });
    const active = await getActiveFlashcardPractice();

    expect(active?.attempts).toHaveLength(1);
    expect(active?.currentItem).toMatchObject({ cardId: cardRecord.id, presentationNumber: 2 });
  });

  it("resolves the rating server-side from the binary choice", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      return [];
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const wrongButClaimed = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-0001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "olla", remembered: true, forgot: false, responseTimeMs: 2400 });
    expect(wrongButClaimed.rating).toBe("hard");
    expect(wrongButClaimed.suggestedRating).toBe("forgot");
  });

  it("maps 'Não lembrei' to forgot regardless of the typed answer", async () => {
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-0002", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: false, forgot: false, responseTimeMs: 1200 });
    expect(result.rating).toBe("forgot");
  });

  it("stores a review snapshot of the affected words when applying the incremental review", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4, review_ease: 2.5 } }];
      return [];
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-0003", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: true, responseTimeMs: 2400 });
    const attemptUpdate = updateRecord.mock.calls.find(([table]) => table === "flashcardAttempts");
    const snapshot = JSON.parse((attemptUpdate![2] as { review_snapshot: string }).review_snapshot);
    expect(snapshot["word-a"]).toMatchObject({ familiarity_score: 4, review_ease: 2.5 });
  });

  it("previews exact intervals for both binary choices without persisting", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } }];
      return [];
    });
    const { previewFlashcardAttemptIntervals } = await import("../../lib/learning/flashcards");
    const preview = await previewFlashcardAttemptIntervals({ sessionId: session.id, cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", responseTimeMs: 1200 });
    expect(preview.match).toBe("exact");
    expect(preview.inferredRating).toBe("easy");
    expect(preview.forgotDays).toBe(1);
    expect(preview.rememberedDays).toBeGreaterThan(preview.forgotDays);
    expect(createRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("rejects the preview when the card is not the current queue item", async () => {
    const { previewFlashcardAttemptIntervals } = await import("../../lib/learning/flashcards");
    await expect(previewFlashcardAttemptIntervals({ sessionId: session.id, cardId: cardRecord.id, presentationNumber: 2, userAnswer: "hola" })).rejects.toThrow("fila");
  });

  it("undoes the latest attempt: restores the snapshot and marks it undone", async () => {
    attempts = [{ id: "attempt-1", fields: { practice_session_id: session.id, flashcard_id: cardRecord.id, word_id: "word-a", presentation_number: 1, client_attempt_id: "u-001", user_answer: "hola", normalized_answer: "hola", match_result: "exact", suggested_rating: "easy", final_rating: "easy", was_correct: true, response_time_ms: 1200, used_speech: false, audio_replay_count: 0, review_applied: true, review_snapshot: JSON.stringify({ "word-a": { familiarity_score: 4, review_ease: 2.5, review_state: "learning" } }), created_at: "2026-07-10T12:01:00.000Z" } }];
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      if (table === "words") return [{ id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 5.5 } }];
      return [];
    });
    const { undoFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await undoFlashcardAttempt(session.id);
    expect(result).toEqual({ cardId: cardRecord.id, presentationNumber: 1 });
    expect(updateRecord).toHaveBeenCalledWith("words", "word-a", expect.objectContaining({ familiarity_score: 4, review_ease: 2.5, review_state: "learning" }));
    expect(updateRecord).toHaveBeenCalledWith("flashcardAttempts", "attempt-1", expect.objectContaining({ undone_at: expect.any(String), review_applied: false }));
    expect(updateRecord).toHaveBeenCalledWith("practiceSessions", session.id, expect.objectContaining({ presentation_count: 0 }));
  });

  it("refuses to undo when there is nothing to undo", async () => {
    const { undoFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await expect(undoFlashcardAttempt(session.id)).rejects.toThrow("desfazer");
  });

  it("skips already-undone attempts and undoes the latest live one", async () => {
    attempts = [
      { id: "attempt-1", fields: { practice_session_id: session.id, flashcard_id: cardRecord.id, word_id: "word-a", presentation_number: 1, client_attempt_id: "u-010", user_answer: "x", normalized_answer: "x", match_result: "incorrect", suggested_rating: "forgot", final_rating: "forgot", was_correct: false, response_time_ms: 900, used_speech: false, audio_replay_count: 0, created_at: "2026-07-10T12:01:00.000Z" } },
      { id: "attempt-2", fields: { practice_session_id: session.id, flashcard_id: cardRecord.id, word_id: "word-a", presentation_number: 2, client_attempt_id: "u-011", user_answer: "hola", normalized_answer: "hola", match_result: "exact", suggested_rating: "easy", final_rating: "easy", was_correct: true, response_time_ms: 1100, used_speech: false, audio_replay_count: 0, created_at: "2026-07-10T12:03:00.000Z", undone_at: "2026-07-10T12:04:00.000Z" } }
    ];
    const { undoFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await undoFlashcardAttempt(session.id);
    expect(result.presentationNumber).toBe(1);
  });

  it("ignores undone attempts when rebuilding the queue", async () => {
    attempts = [{ id: "attempt-0", fields: { practice_session_id: session.id, flashcard_id: cardRecord.id, word_id: "word-a", presentation_number: 1, client_attempt_id: "old-001", user_answer: "x", normalized_answer: "x", match_result: "incorrect", suggested_rating: "forgot", final_rating: "forgot", was_correct: false, response_time_ms: 1000, used_speech: false, audio_replay_count: 0, created_at: "2026-07-10T12:01:00.000Z", undone_at: "2026-07-10T12:02:00.000Z" } }];
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    // Sem o filtro, a tentativa antiga contaria e presentationNumber 1 falharia com 409.
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-0004", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: true, responseTimeMs: 1500 });
    expect(result.presentationNumber).toBe(1);
  });
});
