# PR A — Fundação SRS v2 (Reformulação da Revisão Inteligente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformular o núcleo de agendamento da Revisão Inteligente: passos de aprendizado, relearning em lapsos, fuzz de intervalos, leech flag, persistência incremental do SRS por tentativa e desacoplamento conversa↔SRS — sem mudança de UI.

**Architecture:** Evolução do SRS próprio (`srs-v1` → `srs-v2`) em `lib/learning/spaced-repetition.ts` (função pura, sem IO). A gravação do estado de revisão passa a acontecer em cada tentativa persistida (`persistFlashcardAttempt`), com `completeFlashcardPractice` como fallback que só aplica tentativas ainda não aplicadas (flag `review_applied`). O salvamento de vocabulário em conversa deixa de regravar `review_due_at` e passa a creditar revisão implícita leve quando cabível. Migração Teable 100% aditiva.

**Tech Stack:** Next.js 15, TypeScript, Vitest (`npm run test:unit`), Teable (REST, sem transações).

**Spec:** `docs/superpowers/specs/2026-08-02-smart-review-redesign-design.md` (seções 3, 5, 7, 8). Este plano cobre apenas o PR A; PRs B–E terão planos próprios após a conclusão deste.

**Mudança semântica deliberada (revisar com atenção):** a agregação "pior resultado" do `srs-v1` é substituída por aplicação sequencial (fold) das tentativas — requisito da persistência incremental, onde cada tentativa é aplicada no momento em que ocorre. Recuperação dentro da sessão volta a contar (como no Anki). A função `aggregateReviewAttempts` deixa de existir.

## Global Constraints

- `REVIEW_VERSION = "srs-v2"`; migração aditiva: `review_ease`/`review_interval_days`/`review_streak`/`lapse_count` existentes são preservados; novos passos valem a partir da próxima transição.
- Passos de aprendizado: `LEARNING_STEPS_DAYS = [1, 3]`. Palavra nova: `good` → 1d → 3d → gradua (7d). Palavras graduadas persistem `learning_step = LEARNING_STEPS_DAYS.length + 1` (marcador de graduação).
- Lapse em palavra graduada → relearning pelos mesmos passos (1d → 3d) e regraduação com `round(intervalo_pré-lapse × 0.5)` (ou ×0.75 se `easy`), mínimo 4 dias.
- Leech: `lapse_count >= 4` → `leech_flagged_at` gravado uma única vez. Suspensão continua manual (`suspended` preservado).
- Fuzz de ±10% apenas em intervalos graduados ≥ 7 dias, determinístico a partir de `fuzzSeed` (callers passam sempre `word.id`); sem seed → sem fuzz.
- Durante learning/relearning, `review_interval_days` guarda o último intervalo graduado; o agendamento real vive em `review_due_at`.
- Mudanças de schema Teable estritamente aditivas, via script `scripts/ensure-srs-v2-fields.mjs` (dry-run por padrão, `--apply` para aplicar).
- Idempotência por `client_attempt_id`/`clientCompletionId` mantida; falha da gravação incremental NUNCA falha a tentativa — evento `flashcard_incremental_review_failed` + fallback no complete.
- Limites atuais mantidos: 30 palavras/sessão, 3 apresentações/card, resposta 300 chars.
- Node >=20.19 <23; testes com Vitest; sem novas dependências. Nenhuma mudança de UI neste PR.

## File Structure

- `lib/learning/spaced-repetition.ts` — **reescrito**: algoritmo `srs-v2` (fold sequencial, passos, relearning, fuzz, leech) + novo helper `reviewToWordFields`.
- `tests/unit/spaced-repetition.test.ts` — **reescrito**: expectativas `srs-v2`.
- `lib/learning/conversations.ts` — `WordFields` ganha `learning_step`, `implicit_review_at`, `leech_flagged_at` (linhas 52–76).
- `lib/learning/flashcards.ts` — `FlashcardAttemptFields` ganha `review_applied`/`resulting_review_state`; `attemptRecordToAnswer` expõe `reviewApplied`; `persistFlashcardAttemptUnlocked` aplica SRS incremental; `completeFlashcardPracticeUnlocked` aplica só tentativas não aplicadas; remoção de `calculateLegacyWordReview`.
- `lib/learning/vocabulary-selection.ts` — para de regravar `review_due_at` no update; revisão implícita para palavra graduada vencida usada corretamente.
- `scripts/ensure-srs-v2-fields.mjs` — **novo**: migração aditiva dos campos.
- `package.json` — script `review:srs-v2-fields`.
- `tests/unit/flashcard-persistence.test.ts`, `tests/unit/flashcard-completion.test.ts`, `tests/unit/vocabulary-selection.test.ts`, `tests/unit/flashcards.test.ts` — ajustes e novos casos.

---

### Task 1: Núcleo do algoritmo `srs-v2`

**Files:**
- Modify: `lib/learning/spaced-repetition.ts` (reescrita completa, 181 linhas → ~235)
- Test: `tests/unit/spaced-repetition.test.ts` (reescrita completa)

**Interfaces:**
- Consumes: `RecallRating` de `./flashcard-contracts` (inalterado).
- Produces (usados pelas Tasks 3–5):
  - `REVIEW_VERSION: "srs-v2"`, `LEARNING_STEPS_DAYS: readonly [1, 3]`, `LEECH_LAPSE_THRESHOLD: 4`
  - `calculateAdaptiveReview(current: ReviewFields, attempts: ReviewAttempt[], now?: Date, timeZone?: string, fuzzSeed?: string): AdaptiveReview` — aplica as tentativas **em sequência** (fold); `fuzzSeed` opcional (callers passam `word.id`).
  - `AdaptiveReview` ganha `learningStep: number` e `leechFlaggedAt: string | null`.
  - `reviewToWordFields(review: AdaptiveReview)` → objeto de update para a tabela `words` (inclui `learning_step` e `leech_flagged_at` quando presente).
  - `ReviewFields` ganha `learning_step?: number` e `leech_flagged_at?: string | null`.
  - REMOVIDO: `aggregateReviewAttempts` (sem callers fora de teste).

- [ ] **Step 1: Reescrever o teste que caracteriza o srs-v2 (failing)**

Substituir TODO o conteúdo de `tests/unit/spaced-repetition.test.ts` por:

```ts
import { describe, expect, it } from "vitest";
import { calculateAdaptiveReview, REVIEW_VERSION } from "../../lib/learning/spaced-repetition";

const now = new Date("2026-07-10T12:00:00.000Z");

describe("adaptive spaced repetition v2", () => {
  it("starts a brand-new word in learning with a one-day step", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "good", responseTimeMs: 3_000, cardType: "target_to_native" }], now);
    expect(review).toMatchObject({
      reviewIntervalDays: 1, learningStep: 1, reviewStreak: 1, reviewEase: 2.3,
      lapseCount: 0, familiarityScore: 1, reviewState: "learning",
      lastRating: "good", reviewVersion: REVIEW_VERSION
    });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("advances through the learning steps and graduates to a seven-day interval", () => {
    const step1 = calculateAdaptiveReview({}, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(step1).toMatchObject({ learningStep: 1, reviewStreak: 1, reviewState: "learning" });
    expect(step1.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
    const step2 = calculateAdaptiveReview({ learning_step: 1, review_streak: 1, review_ease: 2.3 }, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(step2).toMatchObject({ learningStep: 2, reviewStreak: 2, reviewState: "learning" });
    expect(step2.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
    const graduated = calculateAdaptiveReview({ learning_step: 2, review_streak: 2, review_ease: 2.3 }, [{ rating: "good", responseTimeMs: 3_000 }], now);
    expect(graduated).toMatchObject({ reviewIntervalDays: 7, learningStep: 3, reviewStreak: 3, reviewState: "review" });
    expect(graduated.reviewDueAt).toBe("2026-07-17T09:00:00.000Z");
  });

  it("fast-tracks learning on easy and graduates with a fifteen-day interval", () => {
    const fastTracked = calculateAdaptiveReview({}, [{ rating: "easy", responseTimeMs: 1_000 }], now);
    expect(fastTracked).toMatchObject({ learningStep: 2, reviewEase: 2.4, reviewStreak: 1, reviewState: "learning" });
    expect(fastTracked.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
    const graduated = calculateAdaptiveReview({ learning_step: 1, review_streak: 1, review_ease: 2.3 }, [{ rating: "easy", responseTimeMs: 1_000 }], now);
    expect(graduated).toMatchObject({ reviewIntervalDays: 15, learningStep: 3, reviewEase: 2.4, reviewState: "review" });
  });

  it("keeps the graduated growth formula for mastered words", () => {
    const mastered = calculateAdaptiveReview(
      { review_streak: 4, review_interval_days: 60, review_ease: 2.5, review_state: "review" },
      [{ rating: "easy", responseTimeMs: 1_000 }], now
    );
    expect(mastered).toMatchObject({ reviewIntervalDays: 231, reviewEase: 2.6, reviewStreak: 5, reviewState: "review" });
  });

  it("sends a graduated lapse into relearning, keeping the pre-lapse interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 2.6, review_streak: 5, lapse_count: 1, last_rating: "forgot", familiarity_score: 8, review_state: "review" },
      [{ rating: "forgot", responseTimeMs: 2_000 }], now
    );
    expect(review).toMatchObject({
      reviewIntervalDays: 30, learningStep: 0, reviewStreak: 0, lapseCount: 2,
      reviewEase: 2.35, familiarityScore: 6, reviewState: "difficult"
    });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("regraduates from relearning with half the pre-lapse interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 2.35, review_streak: 0, lapse_count: 2, learning_step: 0, last_rating: "forgot", review_state: "difficult" },
      [{ rating: "good", responseTimeMs: 3_000 }, { rating: "good", responseTimeMs: 3_000 }, { rating: "good", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 15, learningStep: 3, reviewStreak: 3, reviewState: "review" });
  });

  it("applies multiple attempts sequentially, crediting in-session recovery", () => {
    const recovered = calculateAdaptiveReview(
      { review_interval_days: 30, review_streak: 5, lapse_count: 0, review_state: "review" },
      [{ rating: "forgot" }, { rating: "good" }, { rating: "good" }], now
    );
    expect(recovered).toMatchObject({ reviewIntervalDays: 30, learningStep: 2, lapseCount: 1, reviewStreak: 2, reviewState: "learning" });
    expect(recovered.reviewDueAt).toBe("2026-07-13T09:00:00.000Z");
  });

  it("keeps graduated hard reviews between one and four days", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 30, review_ease: 1.3, review_streak: 3, review_state: "review" },
      [{ rating: "hard", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ reviewIntervalDays: 4, reviewEase: 1.3, reviewStreak: 2, reviewState: "review" });
  });

  it("repeats the current learning step on hard without graduating", () => {
    const review = calculateAdaptiveReview(
      { learning_step: 1, review_streak: 1, review_ease: 2.3 },
      [{ rating: "hard", responseTimeMs: 3_000 }], now
    );
    expect(review).toMatchObject({ learningStep: 1, reviewStreak: 0, reviewEase: 2.22, reviewState: "learning" });
    expect(review.reviewDueAt).toBe("2026-07-11T09:00:00.000Z");
  });

  it("flags a leech once at the lapse threshold and preserves the timestamp", () => {
    const flagged = calculateAdaptiveReview(
      { review_interval_days: 15, review_ease: 2.3, review_streak: 1, lapse_count: 3, review_state: "review" },
      [{ rating: "forgot" }], now
    );
    expect(flagged).toMatchObject({ lapseCount: 4, reviewState: "difficult", leechFlaggedAt: "2026-07-10T12:00:00.000Z" });
    const again = calculateAdaptiveReview(
      { review_interval_days: 15, lapse_count: 4, learning_step: 0, last_rating: "forgot", leech_flagged_at: "2026-07-01T09:00:00.000Z", review_state: "difficult" },
      [{ rating: "forgot" }], now
    );
    expect(again.leechFlaggedAt).toBe("2026-07-01T09:00:00.000Z");
  });

  it("applies a deterministic interval fuzz only with a seed on long graduated intervals", () => {
    const current = { review_interval_days: 60, review_streak: 4, review_ease: 2.5, review_state: "review" as const };
    const attempt = [{ rating: "good" as const, responseTimeMs: 3_000 }];
    const withoutSeed = calculateAdaptiveReview(current, attempt, now);
    const seededA = calculateAdaptiveReview(current, attempt, now, "UTC", "word-a");
    const seededB = calculateAdaptiveReview(current, attempt, now, "UTC", "word-a");
    expect(withoutSeed.reviewIntervalDays).toBe(150);
    expect(seededA.reviewIntervalDays).toBe(seededB.reviewIntervalDays);
    expect(seededA.reviewIntervalDays).toBeGreaterThanOrEqual(135);
    expect(seededA.reviewIntervalDays).toBeLessThanOrEqual(165);
  });

  it("keeps due dates on the learner calendar across a timezone offset", () => {
    const review = calculateAdaptiveReview({}, [{ rating: "forgot" }], new Date("2026-07-10T02:30:00.000Z"), "America/Sao_Paulo");
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(review.reviewDueAt));
    expect(localDate).toBe("2026-07-10");
  });

  it("normalizes incomplete legacy data and caps the largest interval", () => {
    const review = calculateAdaptiveReview(
      { review_interval_days: 9_999, review_ease: 99, review_streak: -2, lapse_count: -1, review_state: "review" },
      [{ rating: "easy" }], now, "not/a-timezone"
    );
    expect(review).toMatchObject({ reviewIntervalDays: 365, reviewEase: 2.8, reviewStreak: 1, lapseCount: 0, reviewVersion: REVIEW_VERSION });
  });

  it("preserves a suspended word while recording the review fields", () => {
    const review = calculateAdaptiveReview({ review_state: "suspended" }, [{ rating: "good" }], now);
    expect(review.reviewState).toBe("suspended");
  });

  it("requires at least one attempt", () => {
    expect(() => calculateAdaptiveReview({}, [], now)).toThrow("At least one review attempt is required.");
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `npx vitest run tests/unit/spaced-repetition.test.ts`
Expected: FAIL — `learningStep`/`leechFlaggedAt` não existem, intervalos divergem (srs-v1 ainda ativo).

- [ ] **Step 3: Reescrever `lib/learning/spaced-repetition.ts` (implementação completa)**

Substituir TODO o arquivo por:

```ts
import type { RecallRating } from "./flashcard-contracts";

export const REVIEW_VERSION = "srs-v2";
export const LEARNING_STEPS_DAYS = [1, 3] as const;
export const LEECH_LAPSE_THRESHOLD = 4;

export type ReviewState = "new" | "learning" | "review" | "difficult" | "suspended";
export type ReviewCardType = "target_to_native" | "native_to_target" | "cloze" | "listening";

export type ReviewFields = {
  familiarity_score?: number;
  review_interval_days?: number;
  review_ease?: number;
  review_streak?: number;
  lapse_count?: number;
  learning_step?: number;
  last_reviewed_at?: string;
  last_rating?: RecallRating;
  average_response_time_ms?: number;
  review_state?: ReviewState;
  review_version?: string;
  leech_flagged_at?: string | null;
};

export type ReviewAttempt = {
  rating: RecallRating;
  responseTimeMs?: number;
  cardType?: ReviewCardType;
};

export type AdaptiveReview = {
  familiarityScore: number;
  reviewIntervalDays: number;
  reviewEase: number;
  reviewStreak: number;
  lapseCount: number;
  learningStep: number;
  lastReviewedAt: string;
  lastRating: RecallRating;
  averageResponseTimeMs: number;
  reviewState: ReviewState;
  reviewVersion: typeof REVIEW_VERSION;
  reviewDueAt: string;
  leechFlaggedAt: string | null;
};

type ScheduleState = {
  familiarityScore: number;
  intervalDays: number;
  ease: number;
  streak: number;
  lapseCount: number;
  learningStep: number;
  graduated: boolean;
};

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const MAX_INTERVAL_DAYS = 365;
const responseTargetMs: Record<ReviewCardType, number> = {
  target_to_native: 3_000,
  native_to_target: 4_000,
  cloze: 6_000,
  listening: 7_000
};

// Applies each attempt in order (fold). In-session recovery is credited, matching
// the incremental persistence model where each attempt is applied as it happens.
export function calculateAdaptiveReview(current: ReviewFields, attempts: ReviewAttempt[], now = new Date(), timeZone = "UTC", fuzzSeed = ""): AdaptiveReview {
  if (!attempts.length) throw new Error("At least one review attempt is required.");
  const graduated = isGraduated(current);
  let state: ScheduleState = {
    familiarityScore: clampNumber(current.familiarity_score, 0, 10, 0),
    intervalDays: clampInt(current.review_interval_days, 1, MAX_INTERVAL_DAYS, 1),
    ease: clampNumber(current.review_ease, MIN_EASE, MAX_EASE, 2.3),
    streak: clampInt(current.review_streak, 0, 100_000, 0),
    lapseCount: clampInt(current.lapse_count, 0, 100_000, 0),
    // Graduated words persist learning_step = LEARNING_STEPS_DAYS.length + 1.
    learningStep: graduated ? LEARNING_STEPS_DAYS.length + 1 : clampInt(current.learning_step, 0, LEARNING_STEPS_DAYS.length, 0),
    graduated
  };
  let dueDays = state.intervalDays;
  let rating: RecallRating = attempts[attempts.length - 1].rating;
  let averageResponseTimeMs = clampInt(current.average_response_time_ms, 0, 300_000, 0);
  for (const attempt of attempts) {
    const result = applyReviewAttempt(state, attempt, fuzzSeed);
    state = result.state;
    dueDays = result.dueDays;
    rating = attempt.rating;
    const responseTimeMs = clampInt(attempt.responseTimeMs, 0, 300_000, 0);
    if (responseTimeMs) averageResponseTimeMs = averageResponseTimeMs ? Math.round((averageResponseTimeMs + responseTimeMs) / 2) : responseTimeMs;
  }
  const leechFlaggedAt = state.lapseCount >= LEECH_LAPSE_THRESHOLD
    ? current.leech_flagged_at || now.toISOString()
    : current.leech_flagged_at || null;
  const reviewState = deriveReviewState({
    suspended: current.review_state === "suspended",
    graduated: state.graduated,
    rating,
    lastRating: current.last_rating,
    streak: state.streak,
    lapseCount: state.lapseCount,
    averageResponseTimeMs
  });
  return {
    familiarityScore: round(state.familiarityScore, 1),
    reviewIntervalDays: state.intervalDays,
    reviewEase: round(state.ease, 2),
    reviewStreak: state.streak,
    lapseCount: state.lapseCount,
    learningStep: state.learningStep,
    lastReviewedAt: now.toISOString(),
    lastRating: rating,
    averageResponseTimeMs,
    reviewState,
    reviewVersion: REVIEW_VERSION,
    reviewDueAt: dueAtInTimeZone(now, dueDays, timeZone),
    leechFlaggedAt
  };
}

// Maps a computed review to a `words` table update (shared by incremental and batch paths).
export function reviewToWordFields(review: AdaptiveReview) {
  return {
    familiarity_score: review.familiarityScore,
    review_due_at: review.reviewDueAt,
    review_interval_days: review.reviewIntervalDays,
    review_ease: review.reviewEase,
    review_streak: review.reviewStreak,
    lapse_count: review.lapseCount,
    learning_step: review.learningStep,
    last_reviewed_at: review.lastReviewedAt,
    last_rating: review.lastRating,
    average_response_time_ms: review.averageResponseTimeMs,
    review_state: review.reviewState,
    review_version: review.reviewVersion,
    ...(review.leechFlaggedAt ? { leech_flagged_at: review.leechFlaggedAt } : {})
  };
}

function isGraduated(current: ReviewFields) {
  if (typeof current.learning_step === "number") return current.learning_step > LEARNING_STEPS_DAYS.length;
  // Legacy words (srs-v1) have no learning_step: infer from the persisted state.
  if (current.review_state === "review") return true;
  if (current.review_state === "difficult") return clampInt(current.review_interval_days, 1, MAX_INTERVAL_DAYS, 1) > LEARNING_STEPS_DAYS[LEARNING_STEPS_DAYS.length - 1];
  return false;
}

function applyReviewAttempt(state: ScheduleState, attempt: ReviewAttempt, fuzzSeed: string): { state: ScheduleState; dueDays: number } {
  const rating = attempt.rating;
  const factor = responseAdjustment(attempt);
  const next = { ...state };
  let dueDays: number;

  if (!state.graduated) {
    const isRelearning = state.lapseCount > 0;
    if (rating === "forgot") {
      next.learningStep = 0;
      next.ease = clampNumber(state.ease - 0.25, MIN_EASE, MAX_EASE, MIN_EASE);
      next.streak = 0;
      next.familiarityScore = clampNumber(state.familiarityScore - 2, 0, 10, 0);
      if (isRelearning) next.lapseCount = state.lapseCount + 1;
      dueDays = LEARNING_STEPS_DAYS[0];
    } else if (rating === "hard") {
      // Repeat the current step's due without advancing.
      next.ease = clampNumber(state.ease - 0.08, MIN_EASE, MAX_EASE, MIN_EASE);
      next.streak = Math.max(0, state.streak - 1);
      next.familiarityScore = clampNumber(state.familiarityScore - 0.5, 0, 10, 0);
      dueDays = learningStepDueDays(state.learningStep);
    } else {
      next.streak = state.streak + 1;
      const nextStep = state.learningStep + (rating === "easy" ? 2 : 1);
      next.ease = clampNumber(state.ease + (rating === "easy" ? 0.1 : 0), MIN_EASE, MAX_EASE, state.ease);
      next.familiarityScore = clampNumber(state.familiarityScore + (rating === "easy" ? 1.2 : 1), 0, 10, 10);
      if (nextStep > LEARNING_STEPS_DAYS.length) {
        next.graduated = true;
        next.learningStep = LEARNING_STEPS_DAYS.length + 1;
        const graduatedInterval = isRelearning
          ? clampInt(Math.round(state.intervalDays * (rating === "easy" ? 0.75 : 0.5)), 4, MAX_INTERVAL_DAYS, 4)
          : rating === "easy" ? 15 : 7;
        next.intervalDays = fuzzInterval(graduatedInterval, fuzzSeed);
        dueDays = next.intervalDays;
      } else {
        next.learningStep = nextStep;
        dueDays = learningStepDueDays(nextStep);
      }
    }
  } else if (rating === "forgot") {
    // Lapse: relearning from step zero; intervalDays keeps the pre-lapse value for regraduation.
    next.graduated = false;
    next.learningStep = 0;
    next.lapseCount = state.lapseCount + 1;
    next.ease = clampNumber(state.ease - 0.25, MIN_EASE, MAX_EASE, MIN_EASE);
    next.streak = 0;
    next.familiarityScore = clampNumber(state.familiarityScore - 2, 0, 10, 0);
    dueDays = LEARNING_STEPS_DAYS[0];
  } else if (rating === "hard") {
    next.intervalDays = clampInt(Math.round(state.intervalDays * 1.2 * factor), 1, 4, 1);
    next.ease = clampNumber(state.ease - 0.08, MIN_EASE, MAX_EASE, MIN_EASE);
    next.streak = Math.max(0, state.streak - 1);
    next.familiarityScore = clampNumber(state.familiarityScore - 0.5, 0, 10, 0);
    dueDays = next.intervalDays;
  } else {
    next.streak = state.streak + 1;
    const initialIntervals = rating === "easy" ? [7, 15, 30, 60] : [3, 7, 15, 30];
    const initialInterval = initialIntervals[Math.min(next.streak - 1, initialIntervals.length - 1)];
    const multiplier = rating === "easy" ? (state.ease + 0.35) * 1.25 : state.ease;
    const interval = clampInt(Math.round(Math.max(initialInterval, state.intervalDays * multiplier * factor)), 1, MAX_INTERVAL_DAYS, initialInterval);
    next.intervalDays = fuzzInterval(interval, fuzzSeed);
    next.ease = clampNumber(state.ease + (rating === "easy" ? 0.1 : 0), MIN_EASE, MAX_EASE, state.ease);
    next.familiarityScore = clampNumber(state.familiarityScore + (rating === "easy" ? 1.2 : 1), 0, 10, 10);
    dueDays = next.intervalDays;
  }
  return { state: next, dueDays };
}

// Due days for the current learning step (step 0 also maps to the first step).
function learningStepDueDays(step: number) {
  return LEARNING_STEPS_DAYS[clampInt(step - 1, 0, LEARNING_STEPS_DAYS.length - 1, 0)];
}

function deriveReviewState(input: { suspended: boolean; graduated: boolean; rating: RecallRating; lastRating?: RecallRating; streak: number; lapseCount: number; averageResponseTimeMs: number }): ReviewState {
  if (input.suspended) return "suspended";
  const slowRepeatedly = input.averageResponseTimeMs >= 8_000 && input.streak >= 2;
  const repeatedFailure = input.rating === "forgot" && input.lastRating === "forgot";
  const repeatedHard = input.rating === "hard" && input.lastRating === "hard";
  const frequentLapses = input.lapseCount >= 3 && input.streak <= 1;
  if (repeatedFailure || repeatedHard || frequentLapses || slowRepeatedly) return "difficult";
  return input.graduated ? "review" : "learning";
}

function responseAdjustment(attempt: ReviewAttempt) {
  const responseTimeMs = clampInt(attempt.responseTimeMs, 0, 300_000, 0);
  if (!responseTimeMs) return 1;
  const target = responseTargetMs[attempt.cardType ?? "target_to_native"];
  if (responseTimeMs <= target * 0.7) return 1.08;
  if (responseTimeMs >= target * 1.6) return 0.9;
  return 1;
}

// Deterministic ±10% fuzz so cards reviewed together stop sharing due dates.
function fuzzInterval(intervalDays: number, seed: string) {
  if (!seed || intervalDays < 7) return intervalDays;
  const range = Math.max(1, Math.round(intervalDays * 0.1));
  const hash = hashSeed(`${seed}:${intervalDays}`);
  const offset = (hash % (2 * range + 1)) - range;
  return clampInt(intervalDays + offset, 1, MAX_INTERVAL_DAYS, intervalDays);
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function dueAtInTimeZone(now: Date, days: number, requestedTimeZone: string) {
  const timeZone = isTimeZone(requestedTimeZone) ? requestedTimeZone : "UTC";
  const local = zonedParts(now, timeZone);
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day) + days * DAY_MS);
  return zonedDateTimeToUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(), hour: 9, minute: 0, second: 0 }, timeZone).toISOString();
}

function zonedDateTimeToUtc(target: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timeZone: string) {
  let value = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const targetValue = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(new Date(value), timeZone);
    const actualValue = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    value += targetValue - actualValue;
  }
  return new Date(value);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function clampInt(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
```

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/spaced-repetition.test.ts`
Expected: PASS (15 testes).

- [ ] **Step 5: Verificar que nada mais importa o que foi removido**

Run: `grep -rn "aggregateReviewAttempts\|REVIEW_VERSION" lib app components tests --include="*.ts" --include="*.tsx" | grep -v "spaced-repetition"`
Expected: nenhuma ocorrência de `aggregateReviewAttempts`; `REVIEW_VERSION` apenas em `tests/unit/spaced-repetition.test.ts`. Se aparecer caller inesperado, ajustar antes de prosseguir.

- [ ] **Step 6: Commit**

```bash
git add lib/learning/spaced-repetition.ts tests/unit/spaced-repetition.test.ts
git commit -m "feat(review): srs-v2 learning steps, relearning, fuzz and leech flag"
```

---

### Task 2: Tipos e migração aditiva de schema

**Files:**
- Modify: `lib/learning/conversations.ts:52-76` (`WordFields`)
- Modify: `lib/learning/flashcards.ts:68-87` (`FlashcardAttemptFields`)
- Create: `scripts/ensure-srs-v2-fields.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nada das outras tasks (pode rodar em paralelo com a Task 1).
- Produces:
  - `WordFields.learning_step?: number`, `WordFields.implicit_review_at?: string`, `WordFields.leech_flagged_at?: string` (Tasks 3–5 gravam esses campos).
  - `FlashcardAttemptFields.review_applied?: boolean`, `FlashcardAttemptFields.resulting_review_state?: string` (Tasks 3–4).
  - `UserFields` (já existe em `lib/learning/profile.ts:6`, tem `timezone?: string`) — usado na Task 5.

- [ ] **Step 1: Adicionar campos aos tipos**

Em `lib/learning/conversations.ts`, dentro de `WordFields`, após `review_version?: string;`, adicionar:

```ts
  learning_step?: number;
  implicit_review_at?: string;
  leech_flagged_at?: string;
```

Em `lib/learning/flashcards.ts`, dentro de `FlashcardAttemptFields`, após `audio_failed?: boolean;`, adicionar:

```ts
  review_applied?: boolean;
  resulting_review_state?: string;
```

- [ ] **Step 2: Criar o script de migração `scripts/ensure-srs-v2-fields.mjs`**

Segue o padrão de `scripts/ensure-vocabulary-family-fields.mjs` (usa `readEnv`/`required`/`teableRequest` de `./qa-env.mjs`):

```js
import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const FIELD_PLAN = [
  {
    envName: "TEABLE_WORDS_TABLE_ID",
    fields: [
      { type: "number", name: "learning_step", description: "SRS v2: current learning/relearning step index (step count + 1 when graduated)." },
      { type: "date", name: "implicit_review_at", description: "SRS v2: last implicit review credited from correct conversation use." },
      { type: "date", name: "leech_flagged_at", description: "SRS v2: when the word crossed the leech lapse threshold." }
    ]
  },
  {
    envName: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
    fields: [
      { type: "checkbox", name: "review_applied", description: "SRS v2: whether the incremental SRS update for this attempt was persisted to the word." },
      { type: "singleLineText", name: "resulting_review_state", description: "SRS v2: review state resulting from the incremental update (audit)." }
    ]
  }
];

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const env = readEnv(option("--env") ?? ".env.local");
  const apply = process.argv.includes("--apply");
  const report = [];

  for (const table of FIELD_PLAN) {
    const tableId = required(env, table.envName);
    const existing = await teableRequest(env, `/api/table/${tableId}/field`);
    const existingNames = new Set((Array.isArray(existing) ? existing : []).map((field) => field?.name));
    for (const field of table.fields) {
      const exists = existingNames.has(field.name);
      let created = null;
      if (!exists && apply) {
        created = await teableRequest(env, `/api/table/${tableId}/field`, {
          method: "POST",
          body: JSON.stringify({ ...field, notNull: false })
        });
      }
      report.push({
        table: table.envName,
        name: field.name,
        fieldExists: exists || Boolean(created),
        fieldId: created?.id ?? null,
        action: exists ? "none" : apply ? "created" : "create-required"
      });
    }
  }

  console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", fields: report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 3: Registrar o script no `package.json`**

Adicionar em `"scripts"`, após `"vocabulary:usage-migrate"`:

```json
    "review:srs-v2-fields": "node scripts/ensure-srs-v2-fields.mjs",
```

- [ ] **Step 4: Verificar typecheck e dry-run da migração**

Run: `npm run typecheck`
Expected: PASS.

Run (dry-run, não altera nada): `node scripts/ensure-srs-v2-fields.mjs --env .env.qa.local`
Expected: JSON com `"mode": "dry-run"` e cada campo com `"action": "none"` ou `"create-required"`.

Aplicar em QA (validação manual, mesmo padrão dos PRs 3–7): `node scripts/ensure-srs-v2-fields.mjs --env .env.qa.local --apply` → todos os campos `"fieldExists": true`. Produção fica para o deploy do PR A, com `--env .env.local --apply`.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/conversations.ts lib/learning/flashcards.ts scripts/ensure-srs-v2-fields.mjs package.json
git commit -m "feat(review): add srs-v2 fields to word and attempt schemas"
```

---

### Task 3: Persistência incremental do SRS por tentativa

**Files:**
- Modify: `lib/learning/flashcards.ts` (`persistFlashcardAttemptUnlocked` ~linhas 378–440; `attemptRecordToAnswer` ~linha 697)
- Test: `tests/unit/flashcard-persistence.test.ts`

**Interfaces:**
- Consumes: `calculateAdaptiveReview`, `reviewToWordFields` (Task 1); `FlashcardAttemptFields.review_applied`/`resulting_review_state`, `WordFields.learning_step`/`leech_flagged_at` (Task 2).
- Produces:
  - `attemptRecordToAnswer(record)` passa a incluir `reviewApplied: boolean` (consumido pela Task 4).
  - Após cada tentativa persistida, todas as palavras do card (`targetWordId` + `supportingWordIds`) têm o SRS atualizado e a tentativa é marcada `review_applied: true`; em falha, evento `flashcard_incremental_review_failed` e a tentativa permanece não aplicada.

- [ ] **Step 1: Escrever os testes novos (failing)**

Em `tests/unit/flashcard-persistence.test.ts`, adicionar dentro do `describe` existente:

```ts
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
    expect(updateRecord).toHaveBeenCalledWith("flashcardAttempts", "attempt-1", { review_applied: true, resulting_review_state: "learning" });
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
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts`
Expected: FAIL — `updateRecord` nunca é chamado com `"words"`/`"flashcardAttempts"`.

- [ ] **Step 3: Implementar a gravação incremental em `lib/learning/flashcards.ts`**

3a. Atualizar o import da linha 12:

```ts
import { calculateAdaptiveReview, reviewToWordFields, type ReviewAttempt } from "./spaced-repetition";
```

3b. Em `attemptRecordToAnswer` (~linha 697), adicionar ao objeto retornado (antes de `audioFailed`):

```ts
    reviewApplied: Boolean(record.fields.review_applied),
```

3c. Em `persistFlashcardAttemptUnlocked`, incluir `words` no `Promise.all` (~linha 384):

```ts
  const [sessions, cardRecords, attemptRecords, words] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000),
    client.listRecords<WordFields>("words", 500)
  ]);
```

3d. Imediatamente antes do `return { id: record.id, ...attemptRecordToAnswer(record) };` (fim de `persistFlashcardAttemptUnlocked`), inserir:

```ts
  const attemptWordIds = [card.targetWordId, ...card.supportingWordIds];
  const reviewableWords = words.filter((item) => attemptWordIds.includes(item.id) && matchesLearningScope(item.fields, { userId: user.id, profileId: profile.id }));
  if (reviewableWords.length) {
    try {
      let resultingState = "";
      for (const word of reviewableWords) {
        const review = calculateAdaptiveReview(word.fields, [{ rating, responseTimeMs, cardType: card.type }], new Date(now), user.fields.timezone ?? "UTC", word.id);
        await client.updateRecord<WordFields>("words", word.id, reviewToWordFields(review));
        if (word.id === card.targetWordId) resultingState = review.reviewState;
      }
      await client.updateRecord<FlashcardAttemptFields>("flashcardAttempts", record.id, { review_applied: true, resulting_review_state: resultingState });
    } catch (error) {
      await client.createEvent(user.id, "flashcard_incremental_review_failed", { session_id: sessionId, flashcard_id: card.id, message: error instanceof Error ? error.message : "unknown" });
    }
  }
```

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts`
Expected: PASS (4 testes: 2 existentes + 2 novos). Os testes existentes continuam passando porque o mock retorna `[]` para `words` → gravação incremental é pulada.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcard-persistence.test.ts
git commit -m "feat(review): persist srs state incrementally on each attempt"
```

---

### Task 4: Complete como fallback — aplica só tentativas não aplicadas

**Files:**
- Modify: `lib/learning/flashcards.ts` (`completeFlashcardPracticeUnlocked` ~linhas 452–553)
- Test: `tests/unit/flashcard-completion.test.ts`

**Interfaces:**
- Consumes: `reviewApplied` de `attemptRecordToAnswer` (Task 3); `reviewToWordFields` (Task 1).
- Produces: contrato mantido — métricas usam TODAS as tentativas; o update SRS em `words` usa apenas tentativas com `review_applied` ausente/falso (client-batch fallback é sempre integralmente aplicado).

- [ ] **Step 1: Escrever os testes (failing)**

Em `tests/unit/flashcard-completion.test.ts`:

1a. Declarar `let attemptRecords: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }> = [];` junto às outras variáveis (após `let words...`), resetar no `beforeEach` (`attemptRecords = [];`) e ajustar o mock:

```ts
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcardAttempts") return attemptRecords;
      return words;
    });
```

1b. Adicionar os testes dentro do `describe`:

```ts
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
```

e o helper no fim do arquivo:

```ts
function appliedAttempt(id: string, cardId: string, wordId: string, clientAttemptId: string, reviewApplied = true) {
  return {
    id,
    createdTime: "2026-07-10T12:00:00.000Z",
    fields: {
      practice_session_id: "session-a", flashcard_id: cardId, word_id: wordId,
      presentation_number: 1, client_attempt_id: clientAttemptId,
      user_answer: "resposta", normalized_answer: "resposta", match_result: "exact",
      suggested_rating: "good", final_rating: "good", was_correct: true,
      response_time_ms: 1500, used_speech: false, audio_replay_count: 0,
      review_applied: reviewApplied, created_at: "2026-07-10T12:00:00.000Z"
    }
  };
}
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/flashcard-completion.test.ts`
Expected: FAIL no primeiro teste novo — hoje `words` é atualizado para toda tentativa persistida (2 chamadas, não 0).

- [ ] **Step 3: Implementar em `completeFlashcardPracticeUnlocked`**

3a. Após a montagem de `validatedAnswers` (~linhas 474–477), adicionar:

```ts
  const pendingReviewAnswers = persistedAttempts.length
    ? validatedAnswers.filter((answer) => !answer.reviewApplied)
    : validatedAnswers;
```

3b. Separar o loop de métricas do loop de SRS. O loop atual (~linhas 482–496) vira dois:

```ts
  for (const answer of validatedAnswers) {
    const card = cards.find((item) => item.id === answer.cardId);
    if (card?.type === "listening" && "audioFailed" in answer && answer.audioFailed) continue;
    for (const id of answer.wordIds) {
      const current = results.get(id) ?? { correct: 0, wrong: 0 };
      if (isRatingCorrect(answer.rating)) current.correct += 1;
      else current.wrong += 1;
      results.set(id, current);
    }
  }
  for (const answer of pendingReviewAnswers) {
    const card = cards.find((item) => item.id === answer.cardId);
    if (card?.type === "listening" && "audioFailed" in answer && answer.audioFailed) continue;
    for (const id of answer.wordIds) {
      reviewAttemptsByWord.set(id, [...(reviewAttemptsByWord.get(id) ?? []), {
        rating: answer.rating,
        responseTimeMs: answer.responseTimeMs,
        cardType: card?.type
      }]);
    }
  }
```

3c. No loop de update (~linhas 498–515), iterar sobre `reviewAttemptsByWord.keys()` (em vez de `results.keys()`) e usar `reviewToWordFields` com `fuzzSeed`:

```ts
  for (const wordId of reviewAttemptsByWord.keys()) {
    const word = words.find((item) => item.id === wordId && matchesLearningScope(item.fields, { userId: user.id, profileId: profile.id }));
    if (!word) continue;
    const review = calculateAdaptiveReview(word.fields, reviewAttemptsByWord.get(wordId) ?? [], now, user.fields.timezone ?? "UTC", word.id);
    await client.updateRecord<WordFields>("words", word.id, reviewToWordFields(review));
  }
```

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/flashcard-completion.test.ts tests/unit/flashcard-persistence.test.ts`
Expected: PASS (11 testes no total nos dois arquivos). Os testes de conclusão existentes passam porque o caminho client-batch (`persistedAttempts.length === 0`) aplica tudo, como antes.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcard-completion.test.ts
git commit -m "feat(review): complete applies only attempts without incremental srs"
```

---

### Task 5: Desacoplamento conversa↔SRS e revisão implícita

**Files:**
- Modify: `lib/learning/vocabulary-selection.ts` (`persistSelectedVocabulary`, linhas 410–524)
- Test: `tests/unit/vocabulary-selection.test.ts`

**Interfaces:**
- Consumes: `calculateAdaptiveReview`, `reviewToWordFields` (Task 1); `UserFields` de `./profile` (type-only).
- Produces:
  - O update de palavra existente NUNCA mais grava `review_due_at` diretamente (criação de palavra nova mantém due inicial de +7d).
  - Palavra com `review_state === "review"` e `review_due_at` vencido, usada corretamente pelo usuário (`correctUseCount > 0`), recebe revisão implícita: fold de um `good` + `implicit_review_at`.

- [ ] **Step 1: Escrever os testes (failing)**

Em `tests/unit/vocabulary-selection.test.ts`, adicionar um novo `describe` dentro do describe raiz (após os existentes):

```ts
  describe("SRS decoupling", () => {
    function pushReviewWord(id: string, fields: Record<string, unknown>) {
      words.push({
        id,
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "cafe",
          display_text: "cafe",
          canonical_key: JSON.stringify(["user-1", "profile-1", "cafe"]),
          forms_json: "[]",
          translation: "café",
          part_of_speech: "noun",
          total_uses: 5,
          familiarity_score: 6,
          ...fields
        }
      });
      messages = [buildMessage(`m-${id}`, "user", "cafe culture")];
    }

    it("no longer rewrites review_due_at when an existing word is saved again", async () => {
      pushReviewWord("word-future", { review_state: "review", review_due_at: "2099-01-01T09:00:00.000Z", review_interval_days: 30, review_streak: 5, review_ease: 2.5 });
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
      await saveSelectedVocabulary("conversation-srs-1", ["user:cafe"]);

      const wordUpdates = updateRecord.mock.calls.filter(([table, id]) => table === "words" && id === "word-future");
      expect(wordUpdates).toHaveLength(1);
      expect(wordUpdates[0][2]).not.toHaveProperty("review_due_at");
      expect(words[0].fields.review_due_at).toBe("2099-01-01T09:00:00.000Z");
    });

    it("credits an implicit review when a due graduated word is used correctly", async () => {
      pushReviewWord("word-due", { review_state: "review", review_due_at: "2020-01-01T09:00:00.000Z", review_interval_days: 30, review_streak: 5, review_ease: 2.5 });
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
      await saveSelectedVocabulary("conversation-srs-2", ["user:cafe"]);

      const payload = updateRecord.mock.calls.find(([table, id]) => table === "words" && id === "word-due")?.[2] as Record<string, unknown>;
      expect(payload).toMatchObject({ review_version: "srs-v2", review_state: "review", review_streak: 6 });
      expect(payload.implicit_review_at).toBeTruthy();
      expect(payload.review_interval_days as number).toBeGreaterThanOrEqual(67);
      expect(payload.review_interval_days as number).toBeLessThanOrEqual(83);
      expect(new Date(payload.review_due_at as string).getTime()).toBeGreaterThan(Date.now());
    });
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: FAIL — o primeiro teste encontra `review_due_at` no payload (hoje regravado sempre); o segundo não encontra `implicit_review_at`.

- [ ] **Step 3: Implementar em `lib/learning/vocabulary-selection.ts`**

3a. Imports (topo do arquivo, após a linha 8):

```ts
import { calculateAdaptiveReview, reviewToWordFields } from "./spaced-repetition";
import type { UserFields } from "./profile";
```

3b. Em `persistSelectedVocabulary`, estender o `Promise.all` (linhas 425–429) e derivar o timezone logo depois:

```ts
  const [existingWords, usageSummaries, users, linguisticData] = await Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries"),
    client.listAllRecords<UserFields>("users"),
    analyzeConversationVocabulary(conversationId, selected, language)
  ]);
  const timeZone = users.find((record) => record.id === context.conversation.fields.user_id)?.fields.timezone ?? "UTC";
```

3c. Substituir o bloco de update (linhas 491–499) por:

```ts
    const mergedForms = uniqueVocabularyForms([...parseVocabularyForms(resolvedWord.fields.forms_json), ...forms]);
    const dueTime = resolvedWord.fields.review_due_at ? new Date(resolvedWord.fields.review_due_at).getTime() : 0;
    const implicitReview = correctUseCount > 0 && resolvedWord.fields.review_state === "review" && dueTime > 0 && dueTime <= Date.now()
      ? calculateAdaptiveReview(resolvedWord.fields, [{ rating: "good" }], new Date(now), timeZone, resolvedWord.id)
      : null;
    word = await client.updateRecord<WordFields>("words", resolvedWord.id, {
      forms_json: JSON.stringify(mergedForms),
      total_uses: otherUses + correctUseCount,
      last_used_at: correctUseCount > 0 ? now : resolvedWord.fields.last_used_at,
      ...(!resolvedWord.fields.translation && family.translation ? { translation: family.translation } : {}),
      ...(!resolvedWord.fields.part_of_speech && family.partOfSpeech ? { part_of_speech: family.partOfSpeech } : {}),
      ...(implicitReview ? { ...reviewToWordFields(implicitReview), implicit_review_at: now } : {})
    });
```

Notas:
- `review_due_at: reviewDue` foi REMOVIDO do update (permanece apenas na criação de palavra nova, linha ~472).
- A variável `reviewDue` (linha 431) continua em uso na criação — não remover.
- Palavras novas criadas nesta mesma passagem têm `review_state` ausente → não elegíveis à revisão implícita. Correto: elas entrarão na fila diária como novas (PR B).

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS (todos os existentes + 2 novos). Os existentes passam porque palavras sem `review_state`/due vencido não disparam revisão implícita e o mock de `listRecords` retorna `[]` para `users` (timezone vira `"UTC"`).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/vocabulary-selection.ts tests/unit/vocabulary-selection.test.ts
git commit -m "feat(review): decouple conversation saves from srs and credit implicit reviews"
```

---

### Task 6: Remover código legado e verificação completa

**Files:**
- Modify: `lib/learning/flashcards.ts:186-194` (`calculateLegacyWordReview`)
- Test: `tests/unit/flashcards.test.ts` (remover caso legado)

**Interfaces:**
- Consumes: nada.
- Produces: confirmação de que `calculateLegacyWordReview` não tem callers; suite completa verde.

- [ ] **Step 1: Confirmar ausência de callers**

Run: `grep -rn "calculateLegacyWordReview" lib app components tests scripts --include="*.ts" --include="*.tsx" --include="*.mjs"`
Expected: apenas `lib/learning/flashcards.ts` (definição) e `tests/unit/flashcards.test.ts` (import + teste). Qualquer outro caller precisa ser migrado antes da remoção.

- [ ] **Step 2: Remover a função e o teste legado**

- Em `lib/learning/flashcards.ts`, remover a função `calculateLegacyWordReview` (linhas 186–194).
- Em `tests/unit/flashcards.test.ts`, remover `calculateLegacyWordReview` do import e o teste `"characterizes familiarity and due-date updates"` (linhas 133–138).

- [ ] **Step 3: Rodar a verificação completa**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: tudo PASS, zero falhas.

- [ ] **Step 4: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcards.test.ts
git commit -m "chore(review): remove dead legacy word review algorithm"
```

---

## Self-Review (verificações finais do plano)

- **Cobertura do spec (PR A / seção 10.1):** passos learning/relearning → Task 1; fuzz → Task 1; leech flag → Task 1; persistência incremental → Task 3; fallback no complete → Task 4; desacoplamento da conversa → Task 5; migração aditiva → Task 2; remoção de código morto → Task 6. Sem mudança de UI ✓.
- **Consistência de tipos:** `reviewToWordFields` definido na Task 1, consumido nas Tasks 3–5 com o mesmo nome; `reviewApplied` produzido na Task 3, consumido na Task 4; `learning_step`/`leech_flagged_at`/`implicit_review_at` tipados na Task 2 e gravados via `reviewToWordFields`.
- **Ordem:** Tasks 3–5 dependem da 1 e 2; Task 6 por último. Tasks 1 e 2 são independentes entre si.
- **Pós-PR A (não esquecer):** aplicar `ensure-srs-v2-fields.mjs --apply` em QA e produção; PR B (fila diária) terá plano próprio.
