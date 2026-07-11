import { beforeEach, describe, expect, it, vi } from "vitest";

const createFlashcardPractice = vi.fn();
const completeFlashcardPractice = vi.fn();
const getActiveFlashcardPractice = vi.fn();
const persistFlashcardAttempt = vi.fn();

vi.mock("../../lib/learning/flashcards", () => ({ createFlashcardPractice, completeFlashcardPractice, getActiveFlashcardPractice, persistFlashcardAttempt }));

describe("flashcard API contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards normalized creation input and returns 201", async () => {
    createFlashcardPractice.mockResolvedValue({ sessionId: "session-a", cards: [{ id: "card-a" }] });
    const { POST } = await import("../../app/api/practice/flashcards/route");
    const response = await POST(new Request("http://localhost/api/practice/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ criterion: "oldest", count: 8 })
    }));

    expect(response.status).toBe(201);
    expect(createFlashcardPractice).toHaveBeenCalledWith({ criterion: "oldest", count: 8 });
    expect(await response.json()).toMatchObject({ ok: true, sessionId: "session-a" });
  });

  it("returns the active resumable session", async () => {
    getActiveFlashcardPractice.mockResolvedValue({ sessionId: "session-active", cards: [] });
    const { GET } = await import("../../app/api/practice/flashcards/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, activeSession: { sessionId: "session-active" } });
  });

  it("persists an individual attempt", async () => {
    persistFlashcardAttempt.mockResolvedValue({ id: "attempt-a", cardId: "card-a" });
    const { POST } = await import("../../app/api/practice/flashcards/attempt/route");
    const body = { sessionId: "session-a", clientAttemptId: "attempt-client-001", cardId: "card-a", presentationNumber: 1 };
    const response = await POST(new Request("http://localhost/api/practice/flashcards/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(201);
    expect(persistFlashcardAttempt).toHaveBeenCalledWith(body);
  });

  it("forwards the completion id and answer batch", async () => {
    completeFlashcardPractice.mockResolvedValue({ score: 100, correctCards: 1, wrongCards: 0, totalCards: 1, reviewedWords: 1 });
    const { POST } = await import("../../app/api/practice/flashcards/complete/route");
    const answers = [{ cardId: "card-a", correct: true, wordIds: ["word-a"] }];
    const response = await POST(new Request("http://localhost/api/practice/flashcards/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-a", clientCompletionId: "completion-123", answers })
    }));

    expect(response.status).toBe(200);
    expect(completeFlashcardPractice).toHaveBeenCalledWith("session-a", "completion-123", answers);
    expect(await response.json()).toMatchObject({ ok: true, score: 100 });
  });
});
