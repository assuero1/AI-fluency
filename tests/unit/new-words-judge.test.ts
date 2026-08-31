// tests/unit/new-words-judge.test.ts
import { describe, expect, it, vi } from "vitest";

const { createChatCompletion } = vi.hoisted(() => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

import { mapVerdictToMatch } from "../../lib/learning/new-words-validation";

describe("judgeNewWordsAttempt (contratos)", () => {
  it("mapeia veredito correto para match exact e rating via inferRecallRating", async () => {
    const { inferRecallRating } = await import("../../lib/learning/flashcard-queue");
    const rating = inferRecallRating({ match: mapVerdictToMatch("correct"), forgot: false, responseTimeMs: 2500, cardType: "target_to_native" });
    expect(["good", "easy"]).toContain(rating);
  });

  it("veredito incorreto mapeia para rating esquecido", async () => {
    const { inferRecallRating } = await import("../../lib/learning/flashcard-queue");
    const rating = inferRecallRating({ match: mapVerdictToMatch("incorrect"), forgot: false, responseTimeMs: 1000, cardType: "target_to_native" });
    expect(rating).toBe("forgot");
  });
});

describe("judgeNewWordsAttempt", () => {
  it("recusa tradução vazia", async () => {
    const { judgeNewWordsAttempt } = await import("../../lib/learning/new-words");
    await expect(judgeNewWordsAttempt({ sessionId: "s1", clientAttemptId: "attempt-0001", sentenceId: "c1", userTranslation: "  " })).rejects.toThrow();
  });
});
