import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: {} };
const profile = { id: "profile-a", fields: { language_code: "es", language_name: "Espanhol" } };
const cards = [
  { id: "card-a", sessionId: "session-a", type: "target_to_native", targetWordId: "word-a", supportingWordIds: [], prompt: "hola", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", difficulty: 1 },
  { id: "card-b", sessionId: "session-a", type: "native_to_target", targetWordId: "word-b", supportingWordIds: [], prompt: "bom dia", expectedAnswer: "buen día", acceptedAnswers: [], translation: "bom dia", difficulty: 2 }
];
let session: { id: string; fields: Record<string, unknown> };
let words: Array<{ id: string; fields: Record<string, unknown> }>;
const updateRecord = vi.fn();
const createEvent = vi.fn();
const listRecords = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/learning/profile", () => ({
  getOrCreatePersonalUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, updateRecord, createEvent })
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
    listRecords.mockImplementation(async (table: string) => table === "practiceSessions" ? [session] : words);
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      if (table === "practiceSessions" && id === session.id) session.fields = { ...session.fields, ...fields };
      return { id, fields };
    });
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
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
});

function attempt(cardId: string, presentationNumber: number, userAnswer: string, rating: "forgot" | "hard" | "good" | "easy", forgot = false) {
  return { cardId, presentationNumber, userAnswer, rating, forgot, usedSpeech: false, responseTimeMs: 1500 };
}
