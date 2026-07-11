import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: {} };
const profile = { id: "profile-a", fields: { language_code: "es", language_name: "Espanhol" } };
const session = { id: "session-a", fields: { user_id: user.id, language_profile_id: profile.id, type: "flashcards", status: "active", language_code: "es", focus: "{}", configuration_json: "{}", started_at: "2026-07-10T12:00:00.000Z", created_at: "2026-07-10T12:00:00.000Z" } };
const cardRecord = { id: "card-a", fields: { practice_session_id: session.id, target_word_id: "word-a", supporting_word_ids: "[]", card_type: "native_to_target", prompt: "olá", expected_answer: "hola", accepted_answers: "[]", translation: "olá", explanation: "", sentence: "", audio_text: "", difficulty: 2, initial_position: 0, generation_source: "deterministic", created_at: "2026-07-10T12:00:00.000Z" } };
let attempts: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }> = [];
const listRecords = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/learning/profile", () => ({
  getOrCreatePersonalUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, createRecord, updateRecord, createEvent: vi.fn() })
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
  });

  it("reconstructs the next presentation from persisted history", async () => {
    const { getActiveFlashcardPractice, persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "attempt-client-001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", rating: "hard", forgot: false, responseTimeMs: 2000 });
    const active = await getActiveFlashcardPractice();

    expect(active?.attempts).toHaveLength(1);
    expect(active?.currentItem).toMatchObject({ cardId: cardRecord.id, presentationNumber: 2 });
  });
});
