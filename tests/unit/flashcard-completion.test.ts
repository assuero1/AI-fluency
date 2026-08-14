import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: {} };
const profile = { id: "profile-a", fields: { language_code: "es", language_name: "Espanhol" } };
const cards = [
  { id: "card-a", sessionId: "session-a", type: "target_to_native", targetWordId: "word-a", supportingWordIds: [], prompt: "hola", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", difficulty: 1 },
  { id: "card-b", sessionId: "session-a", type: "native_to_target", targetWordId: "word-b", supportingWordIds: [], prompt: "bom dia", expectedAnswer: "buen día", acceptedAnswers: [], translation: "bom dia", difficulty: 2 }
];
let session: { id: string; fields: Record<string, unknown> };
let words: Array<{ id: string; fields: Record<string, unknown> }>;
let attemptRecords: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }> = [];
const updateRecord = vi.fn();
const createEvent = vi.fn();
const listRecords = vi.fn();
const listAllRecords = vi.fn();
const listRecordsWhere = vi.fn();
const listRecordsWhereAll = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, listAllRecords, listRecordsWhere, listRecordsWhereAll, updateRecord, createEvent })
}));

describe("flashcard completion persistence", () => {
  beforeEach(() => {
    session = {
      id: "session-a",
      fields: {
        user_id: user.id,
        language_profile_id: profile.id,
        type: "flashcards",
        focus: JSON.stringify({ wordIds: ["word-a", "word-b"], cards })
      }
    };
    words = [
      { id: "word-a", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 4 } },
      { id: "word-b", fields: { user_id: user.id, language_profile_id: profile.id, familiarity_score: 8 } }
    ];
    vi.clearAllMocks();
    attemptRecords = [];
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcardAttempts") return attemptRecords;
      if (table === "words") return words;
      return [];
    });
    // Scoped reads (RLS era): delegate to the per-test listRecords data,
    // applying the filters the query would apply.
    listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
      ((await listRecords(table)) as Array<{ fields: Record<string, unknown> }>).filter((record) => String(record.fields[field] ?? "") === value)
    );
    listRecordsWhereAll.mockImplementation(async (table: string, filters: Array<{ field: string; value: string }>) =>
      ((await listRecords(table)) as Array<{ fields: Record<string, unknown> }>).filter((record) =>
        filters.every((filter) => String(record.fields[filter.field] ?? "") === filter.value)
      )
    );
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      if (table === "practiceSessions" && id === session.id) session.fields = { ...session.fields, ...fields };
      return { id, fields };
    });
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
    listAllRecords.mockResolvedValue([]);
  });

  it("persists the result and returns it for a retry with the same completion id", async () => {
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const answers = [
      attempt("card-a", 1, "olá", "good"),
      attempt("card-b", 1, "", "forgot", true),
      attempt("card-b", 2, "", "forgot", true),
      attempt("card-b", 3, "", "forgot", true)
    ];
    const first = await completeFlashcardPractice("session-a", "completion-123", answers);
    const second = await completeFlashcardPractice("session-a", "completion-123", answers);

    expect(first).toMatchObject({ score: 50, correctCards: 1, wrongCards: 1, totalCards: 2, reviewedWords: 2, uniqueCardCount: 2, presentationCount: 4, firstAttemptCorrect: 1, recoveredCards: 0, firstAttemptAccuracy: 50, eventualRecallAccuracy: 50, productionAccuracy: 0, comprehensionAccuracy: 100, listeningAccuracy: null, averageResponseTimeMs: 1500, difficultWords: 0, slowWords: 0 });
    expect(first.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(second).toEqual(first);
    expect(updateRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(2);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a different completion id after accounting", async () => {
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const answers = cards.map((card) => attempt(card.id, 1, card.expectedAnswer, "good"));
    await completeFlashcardPractice("session-a", "completion-123", answers);
    await expect(completeFlashcardPractice("session-a", "completion-456", answers)).rejects.toMatchObject({ status: 409 });
  });

  it("separates unique cards from presentations and counts recovered cards", async () => {
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const result = await completeFlashcardPractice("session-a", "completion-123", [
      attempt("card-a", 1, "", "forgot", true),
      attempt("card-b", 1, "buen día", "good"),
      attempt("card-a", 2, "olá", "good")
    ]);

    expect(result).toMatchObject({ score: 100, uniqueCardCount: 2, presentationCount: 3, firstAttemptCorrect: 1, recoveredCards: 1 });
  });

  it("coalesces concurrent completion calls in this server process", async () => {
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const answers = cards.map((card) => attempt(card.id, 1, card.expectedAnswer, "good"));
    const [first, second] = await Promise.all([
      completeFlashcardPractice("session-a", "completion-123", answers),
      completeFlashcardPractice("session-a", "completion-123", answers)
    ]);

    expect(second).toEqual(first);
    expect(updateRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(2);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects sessions from another learner scope", async () => {
    session.fields.user_id = "user-b";
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    await expect(completeFlashcardPractice("session-a", "completion-123", [])).rejects.toMatchObject({ status: 404 });
  });

  it("skips the SRS write for attempts already applied incrementally", async () => {
    attemptRecords = [
      appliedAttempt("attempt-1", "card-a", "word-a", "client-001"),
      appliedAttempt("attempt-2", "card-b", "word-b", "client-002")
    ];
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const result = await completeFlashcardPractice("session-a", "completion-123", []);

    expect(updateRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
    expect(result).toMatchObject({ score: 100, reviewedWords: 2, presentationCount: 2 });
  });

  it("applies only the attempts missing the incremental update", async () => {
    attemptRecords = [
      appliedAttempt("attempt-1", "card-a", "word-a", "client-001"),
      appliedAttempt("attempt-2", "card-b", "word-b", "client-002", false)
    ];
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    await completeFlashcardPractice("session-a", "completion-123", []);

    const wordUpdates = updateRecord.mock.calls.filter(([table]) => table === "words");
    expect(wordUpdates).toHaveLength(1);
    expect(wordUpdates[0][1]).toBe("word-b");
  });

  it("counts slow words from all attempts, even already-applied ones", async () => {
    const slowAttempt = appliedAttempt("attempt-2", "card-b", "word-b", "client-002");
    slowAttempt.fields.response_time_ms = 9_000;
    attemptRecords = [
      appliedAttempt("attempt-1", "card-a", "word-a", "client-001"),
      slowAttempt
    ];
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    const result = await completeFlashcardPractice("session-a", "completion-123", []);

    expect(result.slowWords).toBe(1);
    expect(updateRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
  });

  it("applies pending attempts of a sense-frozen card to the sense and re-aggregates the word", async () => {
    const senseCard = { ...cards[0], targetSenseId: "sense-a" };
    session.fields.focus = JSON.stringify({ wordIds: ["word-a"], cards: [senseCard] });
    attemptRecords = [appliedAttempt("attempt-1", "card-a", "word-a", "client-001", false)];
    const senses = [
      { id: "sense-a", fields: { word_id: "word-a", translation: "olá", is_primary: true, review_state: "learning", learning_step: 1, review_streak: 1, lapse_count: 0, review_due_at: "2026-07-09T09:00:00.000Z", last_reviewed_at: "2026-07-08T09:00:00.000Z" } },
      { id: "sense-b", fields: { word_id: "word-a", translation: "oi", review_state: "review", review_streak: 4, lapse_count: 0, review_due_at: "2026-07-20T09:00:00.000Z", last_reviewed_at: "2026-07-08T09:00:00.000Z" } }
    ];
    listAllRecords.mockImplementation(async (table: string) => table === "wordSenses" ? senses : []);
    listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
      ((table === "wordSenses" ? senses : await listRecords(table)) as Array<{ fields: Record<string, unknown> }>)
        .filter((record) => String(record.fields[field] ?? "") === value)
    );
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      if (table === "practiceSessions" && id === session.id) session.fields = { ...session.fields, ...fields };
      if (table === "wordSenses") {
        const target = senses.find((item) => item.id === id);
        if (target) target.fields = { ...target.fields, ...fields };
      }
      return { id, fields };
    });
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    await completeFlashcardPractice("session-a", "completion-123", []);

    const senseUpdates = updateRecord.mock.calls.filter(([table]) => table === "wordSenses");
    expect(senseUpdates).toHaveLength(1);
    expect(senseUpdates[0][1]).toBe("sense-a");
    expect(senseUpdates[0][2]).toMatchObject({ review_version: "srs-v2", review_state: "learning", learning_step: 2, last_rating: "good" });
    expect(senseUpdates[0][2]).not.toHaveProperty("familiarity_score");

    const wordUpdates = updateRecord.mock.calls.filter(([table]) => table === "words");
    expect(wordUpdates).toHaveLength(1);
    expect(wordUpdates[0][1]).toBe("word-a");
    expect(wordUpdates[0][2]).toMatchObject({
      review_due_at: "2026-07-20T09:00:00.000Z",
      review_state: "learning",
      last_rating: "good",
      translation: "olá"
    });
  });

  it("keeps the completion word path for sessions whose cards have no targetSenseId", async () => {
    session.fields.focus = JSON.stringify({ wordIds: ["word-a"], cards: [cards[0]] });
    attemptRecords = [appliedAttempt("attempt-1", "card-a", "word-a", "client-001", false)];
    const { completeFlashcardPractice } = await import("../../lib/learning/flashcards");
    await completeFlashcardPractice("session-a", "completion-123", []);

    expect(updateRecord.mock.calls.filter(([table]) => table === "wordSenses")).toHaveLength(0);
    expect(listAllRecords).not.toHaveBeenCalled();
    const wordUpdates = updateRecord.mock.calls.filter(([table]) => table === "words");
    expect(wordUpdates).toHaveLength(1);
    expect(wordUpdates[0][1]).toBe("word-a");
  });
});

function attempt(cardId: string, presentationNumber: number, userAnswer: string, rating: "forgot" | "hard" | "good" | "easy", forgot = false) {
  return { cardId, presentationNumber, userAnswer, rating, forgot, usedSpeech: false, responseTimeMs: 1500 };
}

function appliedAttempt(id: string, cardId: string, wordId: string, clientAttemptId: string, reviewApplied = true) {
  return {
    id,
    createdTime: "2026-07-10T12:00:00.000Z",
    fields: {
      user_id: user.id,
      practice_session_id: "session-a", flashcard_id: cardId, word_id: wordId,
      presentation_number: 1, client_attempt_id: clientAttemptId,
      user_answer: "resposta", normalized_answer: "resposta", match_result: "exact",
      suggested_rating: "good", final_rating: "good", was_correct: true,
      response_time_ms: 1500, used_speech: false, audio_replay_count: 0,
      review_applied: reviewApplied, created_at: "2026-07-10T12:00:00.000Z"
    }
  };
}
