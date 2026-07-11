import { describe, expect, it } from "vitest";
import { summarizeFlashcardObservability } from "../../lib/learning/flashcard-observability";

describe("flashcard observability", () => {
  it("aggregates technical metrics without learner content", () => {
    const summary = summarizeFlashcardObservability([
      { eventName: "flashcard_generation_completed", payload: { duration_ms: 800, fallback_used: true } },
      { eventName: "flashcard_generation_failed", payload: { duration_ms: 500 } },
      { eventName: "flashcard_attempt_evaluated", payload: { evaluation_latency_ms: 40 } },
      { eventName: "flashcard_attempt_evaluated", payload: { evaluation_latency_ms: 60 } },
      { eventName: "flashcard_audio_fallback_activated" },
      { eventName: "flashcard_practice_abandoned" },
      { eventName: "flashcard_duplicate_attempt_prevented" },
      { eventName: "flashcard_duplicate_completion_blocked" },
      { eventName: "flashcard_session_inconsistency" }
    ]);
    expect(summary).toMatchObject({ generationCount: 2, generationFailureCount: 1, generationFailureRate: 50, averageGenerationMs: 800, attemptCount: 2, averageEvaluationLatencyMs: 50, fallbackCount: 2, fallbackRate: 50, abandonedSessionCount: 1, duplicateAttemptCount: 1, duplicateCompletionCount: 1, inconsistencyCount: 1 });
  });
});
