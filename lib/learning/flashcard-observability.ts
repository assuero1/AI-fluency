export type FlashcardEvent = { eventName: string; payload?: Record<string, unknown> };

export function summarizeFlashcardObservability(events: FlashcardEvent[]) {
  const count = (name: string) => events.filter((event) => event.eventName === name).length;
  const values = (name: string, field: string) => events
    .filter((event) => event.eventName === name)
    .map((event) => Number(event.payload?.[field]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const attempts = count("flashcard_attempt_evaluated");
  const generations = count("flashcard_generation_completed") + count("flashcard_generation_failed");
  const fallbacks = events.filter((event) => event.eventName === "flashcard_audio_fallback_activated" || (event.eventName === "flashcard_generation_completed" && event.payload?.fallback_used === true)).length;
  return {
    generationCount: generations,
    generationFailureCount: count("flashcard_generation_failed"),
    generationFailureRate: percentage(count("flashcard_generation_failed"), generations),
    averageGenerationMs: average(values("flashcard_generation_completed", "duration_ms")),
    attemptCount: attempts,
    averageEvaluationLatencyMs: average(values("flashcard_attempt_evaluated", "evaluation_latency_ms")),
    fallbackCount: fallbacks,
    fallbackRate: percentage(fallbacks, Math.max(generations + attempts, 0)),
    abandonedSessionCount: count("flashcard_practice_abandoned"),
    duplicateAttemptCount: count("flashcard_duplicate_attempt_prevented"),
    duplicateCompletionCount: count("flashcard_duplicate_completion_blocked"),
    inconsistencyCount: count("flashcard_session_inconsistency")
  };
}

function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function percentage(value: number, total: number) { return total ? Math.round((value / total) * 10_000) / 100 : 0; }
