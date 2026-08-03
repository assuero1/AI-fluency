# PR B — Fila Diária da Revisão Inteligente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a Revisão Inteligente em uma fila diária calculada pelo servidor (revisões vencidas + quota de novos, interleaved, cap de sessão), com nova tela inicial ("Começar"), sessão custom/difíceis como secundárias, e integração com a página de palavras e a home.

**Architecture:** Lógica pura de fila em `lib/learning/daily-queue.ts` (testável, sem IO). `createFlashcardPractice` ganha `queueKind: daily|custom|difficult`; o caminho `daily` usa a fila computada e grava `queueKind`/`newCardsIntroduced`/`dailyQuota` no JSON `focus` da `practiceSessions` (sem mudança de schema nessa tabela). A quota do usuário vive em `users.daily_new_cards_quota` (migração aditiva). UI do trainer consome um novo resumo no GET existente.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Vitest, Playwright, Teable.

**Spec:** `docs/superpowers/specs/2026-08-02-smart-review-redesign-design.md` (seções 3, 6, 7, 10.2).

## Global Constraints

- Quota de novos default **10/dia**, configurável (`daily_new_cards_quota`, clamp 0–50). Vencidas nunca têm cap de dia; o cap de **sessão** é 30 cards (excedente vira "continuar depois" por recomputação, sem quota extra).
- Fila do dia: `review_due_at <= fim do dia local` (timezone do usuário; due às 9h locais — já garantido pelo srs-v2). "Novo" = palavra sem `last_reviewed_at`.
- Interleaving determinístico: novos distribuídos uniformemente entre revisões (seed = usuário + dia).
- `newCardsIntroduced` conta-se por sessões `flashcards` com `focus.queueKind === "daily"` e status `completed`/`active` iniciadas no dia local (abandonadas não consomem quota).
- Critérios `least_used`/`oldest` sobrevivem **apenas** na sessão custom. Retreinos (`wordIds`/`retrainMode`) não mudam de comportamento e gravam `queueKind: "custom"`.
- Nenhuma mudança destrutiva de schema; migração aditiva via script `scripts/ensure-*.mjs` (dry-run padrão, `--apply` explícito), validada em QA antes de produção.
- Idempotência e contratos existentes mantidos (`client_attempt_id`, completionId, kill switch `FLASHCARD_ACTIVE_RECALL_ENABLED`).
- Back-compat do POST `/api/practice/flashcards`: sem `queueKind`, `wordIds` ou `criterion`/`count` presentes ⇒ `custom`; sem nada ⇒ `daily`.
- Respostas de UI em português; nomes de campos/código em inglês, seguindo o estilo do arquivo.
- Merge local sem push (decisão do usuário).

---

### Task 1: Núcleo da fila diária (`lib/learning/daily-queue.ts`)

**Files:**
- Create: `lib/learning/daily-queue.ts`
- Modify: `lib/learning/spaced-repetition.ts:251-255,264-279` (exportar helpers existentes)
- Modify: `lib/learning/flashcard-contracts.ts` (tipo `DailyQueueSummary`)
- Test: `tests/unit/daily-queue.test.ts`

**Interfaces:**
- Consumes: `zonedParts`, `zonedDateTimeToUtc`, `hashSeed` de `spaced-repetition.ts` (passam a ser exportados); `WordFields` de `./conversations`; `TeableRecord` de `@/lib/teable/client`.
- Produces (usados pelas Tasks 2–5):
  - `DAILY_SESSION_CAP = 30`, `DEFAULT_NEW_CARDS_QUOTA = 10`, `MAX_NEW_CARDS_QUOTA = 50`
  - `normalizeNewCardsQuota(value: unknown, fallback?: number): number`
  - `isNewWord(word): boolean`
  - `computeDailyQueue(words, options): DailyQueue`
  - `interleaveWords(dueWordIds: string[], newWordIds: string[], seed?: string): string[]`
  - `countNewCardsIntroducedToday(sessions, scope, options): number`
  - `summarizeDailyQueue(words, sessions, scope, options): DailyQueueSummary`
  - `selectDifficultWords(words, cap?): T[]`
  - Tipos: `DailyQueue`, `DailyQueueWordFields`, `DailyQueueSessionFields`, `DailyQueueSummary` (este último mora em `flashcard-contracts.ts`)

**Nota de tipagem:** as funções da fila são genéricas sobre `DailyQueueWordFields` (tipo estrutural mínimo definido em `daily-queue.ts`), **não** sobre o `WordFields` completo de `conversations.ts`. Isso permite reuso em `home.ts`, que tem um `WordFields` local mais enxuto, sem casts.

- [ ] **Step 1: Exportar helpers de timezone/hash em spaced-repetition.ts**

Em `lib/learning/spaced-repetition.ts`, adicionar `export` a três funções existentes (sem mudar corpos):

```ts
// linha ~251
export function hashSeed(seed: string) { ... }        // era: function hashSeed
// linha ~264
export function zonedDateTimeToUtc(target: {...}, timeZone: string) { ... }  // era: function
// linha ~275
export function zonedParts(date: Date, timeZone: string) { ... }             // era: function
```

- [ ] **Step 2: Tipo DailyQueueSummary em flashcard-contracts.ts**

Adicionar ao final de `lib/learning/flashcard-contracts.ts`:

```ts
export type DailyQueueSummary = {
  dueCount: number;
  newCount: number;
  sessionCardCount: number;
  remainingCount: number;
  newAvailable: number;
  introducedToday: number;
  quota: number;
  estimatedMinutes: number;
  difficultCount: number;
};
```

- [ ] **Step 3: Escrever os testes que falham**

Criar `tests/unit/daily-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeDailyQueue,
  countNewCardsIntroducedToday,
  DAILY_SESSION_CAP,
  interleaveWords,
  isNewWord,
  normalizeNewCardsQuota,
  selectDifficultWords,
  summarizeDailyQueue
} from "../../lib/learning/daily-queue";
import type { WordFields } from "../../lib/learning/conversations";
import type { TeableRecord } from "../../lib/teable/client";

function word(id: string, fields: Partial<WordFields>): TeableRecord<WordFields> {
  return { id, fields: fields as WordFields };
}

function session(id: string, fields: Record<string, unknown>) {
  return { id, fields: fields as import("../../lib/learning/daily-queue").DailyQueueSessionFields };
}

const NOW = new Date("2026-08-02T15:00:00.000Z");

describe("normalizeNewCardsQuota", () => {
  it("defaults to 10 and clamps to 0..50", () => {
    expect(normalizeNewCardsQuota(undefined)).toBe(10);
    expect(normalizeNewCardsQuota("abc")).toBe(10);
    expect(normalizeNewCardsQuota(-3)).toBe(0);
    expect(normalizeNewCardsQuota(7.6)).toBe(8);
    expect(normalizeNewCardsQuota(99)).toBe(50);
  });
});

describe("isNewWord", () => {
  it("is new only when never reviewed", () => {
    expect(isNewWord(word("a", {}))).toBe(true);
    expect(isNewWord(word("b", { last_reviewed_at: "2026-08-01T13:00:00.000Z" }))).toBe(false);
  });
});

describe("interleaveWords", () => {
  it("returns due order untouched when there are no new cards", () => {
    expect(interleaveWords(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("spreads new cards evenly and deterministically", () => {
    const due = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10"];
    const result = interleaveWords(due, ["n1", "n2"], "seed");
    expect(result).toHaveLength(12);
    expect(result.filter((id) => id.startsWith("n"))).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(result.filter((id) => id.startsWith("d"))).toEqual(due);
    expect(interleaveWords(due, ["n1", "n2"], "seed")).toEqual(result);
    const firstNew = result.findIndex((id) => id.startsWith("n"));
    const secondNew = result.findLastIndex((id) => id.startsWith("n"));
    expect(firstNew).toBeGreaterThan(0);
    expect(secondNew - firstNew).toBeGreaterThan(2);
  });
});

describe("computeDailyQueue", () => {
  const reviewed = (id: string, due: string) => word(id, {
    first_used_at: "2026-07-01T12:00:00.000Z",
    last_reviewed_at: "2026-07-30T13:00:00.000Z",
    review_due_at: due
  });

  it("includes reviews due until end of local day, oldest first", () => {
    const queue = computeDailyQueue([
      reviewed("due-early", "2026-08-01T09:00:00.000Z"),
      reviewed("due-late", "2026-08-02T20:00:00.000Z"),
      reviewed("tomorrow", "2026-08-03T09:00:00.000Z")
    ], { now: NOW, timeZone: "UTC" });
    expect(queue.dueWordIds).toEqual(["due-early", "due-late"]);
  });

  it("respects the local timezone boundary", () => {
    // 2026-08-02T01:00Z is still Aug 1 (22h) in São Paulo: a word due Aug 2 10:00Z
    // is NOT due today there, but IS due today in UTC.
    const atNight = new Date("2026-08-02T01:00:00.000Z");
    const words = [reviewed("target", "2026-08-02T10:00:00.000Z")];
    expect(computeDailyQueue(words, { now: atNight, timeZone: "America/Sao_Paulo" }).dueWordIds).toEqual([]);
    expect(computeDailyQueue(words, { now: atNight, timeZone: "UTC" }).dueWordIds).toEqual(["target"]);
  });

  it("limits new cards by quota minus what was already introduced today", () => {
    const words = [
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" }),
      word("n2", { first_used_at: "2026-07-02T10:00:00.000Z" }),
      word("n3", { first_used_at: "2026-07-03T10:00:00.000Z" })
    ];
    expect(computeDailyQueue(words, { quota: 2, now: NOW }).newWordIds).toEqual(["n1", "n2"]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 1, now: NOW }).newWordIds).toEqual(["n1"]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 2, now: NOW }).newWordIds).toEqual([]);
    expect(computeDailyQueue(words, { quota: 2, introducedToday: 5, now: NOW }).newWordIds).toEqual([]);
  });

  it("caps the session and moves the overflow to remaining", () => {
    const words = Array.from({ length: 35 }, (_, index) =>
      reviewed(`due-${index}`, "2026-08-01T09:00:00.000Z"));
    const queue = computeDailyQueue(words, { now: NOW });
    expect(queue.sessionWordIds).toHaveLength(DAILY_SESSION_CAP);
    expect(queue.remainingWordIds).toHaveLength(5);
  });

  it("interleaves new cards into the session order", () => {
    const words = [
      reviewed("d1", "2026-08-01T09:00:00.000Z"),
      reviewed("d2", "2026-08-01T09:00:00.000Z"),
      reviewed("d3", "2026-08-01T09:00:00.000Z"),
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" })
    ];
    const queue = computeDailyQueue(words, { quota: 10, now: NOW, seed: "u:2026-08-02" });
    expect(queue.sessionWordIds).toHaveLength(4);
    expect(queue.sessionWordIds[0]).not.toBe("n1");
    expect(new Set(queue.sessionWordIds)).toEqual(new Set(["d1", "d2", "d3", "n1"]));
  });
});

describe("countNewCardsIntroducedToday", () => {
  const dailySession = (id: string, startedAt: string, introduced: number, status = "completed") =>
    session(id, {
      type: "flashcards",
      status,
      user_id: "u1",
      language_profile_id: "p1",
      started_at: startedAt,
      focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: introduced })
    });

  it("sums only today's completed/active daily sessions", () => {
    const sessions = [
      dailySession("s1", "2026-08-02T10:00:00.000Z", 4),
      dailySession("s2", "2026-08-02T12:00:00.000Z", 3, "active"),
      dailySession("s3", "2026-08-02T13:00:00.000Z", 9, "abandoned"),
      dailySession("s4", "2026-08-01T10:00:00.000Z", 7),
      session("s5", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T11:00:00.000Z", focus: JSON.stringify({ queueKind: "custom", newCardsIntroduced: 5 }) }),
      session("s6", { type: "conversation", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T11:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 5 }) })
    ];
    expect(countNewCardsIntroducedToday(sessions, { userId: "u1", profileId: "p1" }, { now: NOW, timeZone: "UTC" })).toBe(7);
  });

  it("ignores sessions from other users and tolerates broken focus JSON", () => {
    const sessions = [
      dailySession("s1", "2026-08-02T10:00:00.000Z", 4),
      session("s2", { type: "flashcards", status: "completed", user_id: "u2", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 6 }) }),
      session("s3", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: "{not-json" })
    ];
    expect(countNewCardsIntroducedToday(sessions, { userId: "u1", profileId: "p1" }, { now: NOW, timeZone: "UTC" })).toBe(4);
  });
});

describe("summarizeDailyQueue", () => {
  it("combines queue and day counting into a UI-ready summary", () => {
    const words = [
      word("d1", { last_reviewed_at: "2026-07-30T13:00:00.000Z", review_due_at: "2026-08-01T09:00:00.000Z" }),
      word("n1", { first_used_at: "2026-07-01T10:00:00.000Z" }),
      word("hard", { last_reviewed_at: "2026-07-30T13:00:00.000Z", review_due_at: "2026-08-05T09:00:00.000Z", review_state: "difficult" })
    ];
    const sessions = [
      session("s1", { type: "flashcards", status: "completed", user_id: "u1", language_profile_id: "p1", started_at: "2026-08-02T10:00:00.000Z", focus: JSON.stringify({ queueKind: "daily", newCardsIntroduced: 9 }) })
    ];
    const summary = summarizeDailyQueue(words, sessions, { userId: "u1", profileId: "p1" }, { quota: 10, now: NOW, timeZone: "UTC" });
    expect(summary).toMatchObject({
      dueCount: 1,
      newCount: 1,        // quota 10 - 9 introduzidos = 1 restante
      sessionCardCount: 2,
      introducedToday: 9,
      quota: 10,
      estimatedMinutes: 1,
      difficultCount: 1
    });
  });

  it("reports an empty day honestly", () => {
    const summary = summarizeDailyQueue([], [], { userId: "u1" }, { now: NOW });
    expect(summary).toMatchObject({ dueCount: 0, newCount: 0, sessionCardCount: 0, estimatedMinutes: 0 });
  });
});

describe("selectDifficultWords", () => {
  it("selects difficult or leech-flagged words, most lapses first", () => {
    const selected = selectDifficultWords([
      word("ok", { review_state: "review" }),
      word("leech", { review_state: "review", leech_flagged_at: "2026-08-01T10:00:00.000Z", lapse_count: 5 }),
      word("hard", { review_state: "difficult", lapse_count: 2 }),
      word("harder", { review_state: "difficult", lapse_count: 6 })
    ]);
    expect(selected.map((item) => item.id)).toEqual(["harder", "leech", "hard"]);
  });
});
```

- [ ] **Step 4: Rodar os testes e verificar que falham**

Run: `npx vitest run tests/unit/daily-queue.test.ts`
Expected: FAIL — `Cannot find module '../../lib/learning/daily-queue'`

- [ ] **Step 5: Implementar lib/learning/daily-queue.ts**

```ts
import type { TeableRecord } from "@/lib/teable/client";
import type { DailyQueueSummary } from "./flashcard-contracts";
import { hashSeed, zonedDateTimeToUtc, zonedParts } from "./spaced-repetition";

export const DAILY_SESSION_CAP = 30;
export const DEFAULT_NEW_CARDS_QUOTA = 10;
export const MAX_NEW_CARDS_QUOTA = 50;

// Minimal structural shape the queue needs — satisfied by both the full
// `WordFields` (conversations.ts) and the leaner local type in home.ts.
export type DailyQueueWordFields = {
  first_used_at?: string;
  last_reviewed_at?: string;
  review_due_at?: string;
  review_state?: string;
  leech_flagged_at?: string | null;
  lapse_count?: number;
};

export type DailyQueueSessionFields = {
  type?: string;
  status?: string;
  user_id?: string;
  language_profile_id?: string;
  started_at?: string;
  created_at?: string;
  focus?: string;
};

export type DailyQueue = {
  dueWordIds: string[];
  newWordIds: string[];
  sessionWordIds: string[];
  remainingWordIds: string[];
  quota: number;
  introducedToday: number;
  newAvailable: number;
};

export function normalizeNewCardsQuota(value: unknown, fallback = DEFAULT_NEW_CARDS_QUOTA) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_NEW_CARDS_QUOTA, Math.max(0, Math.round(number)));
}

// "New" in the SRS sense: never reviewed in a flashcard session.
export function isNewWord(word: TeableRecord<DailyQueueWordFields>) {
  return !dateValue(word.fields.last_reviewed_at);
}

export function computeDailyQueue<T extends TeableRecord<DailyQueueWordFields>>(
  words: T[],
  options: { quota?: number; introducedToday?: number; now?: Date; timeZone?: string; sessionCap?: number; seed?: string } = {}
): DailyQueue {
  const quota = normalizeNewCardsQuota(options.quota);
  const introducedToday = Math.max(0, Math.round(Number(options.introducedToday) || 0));
  const cap = Math.max(1, Math.round(Number(options.sessionCap) || DAILY_SESSION_CAP));
  const dayEnd = localDayBounds(options.now ?? new Date(), options.timeZone ?? "UTC").end;
  const due = words
    .filter((word) => !isNewWord(word) && dateValue(word.fields.review_due_at) > 0 && dateValue(word.fields.review_due_at) <= dayEnd)
    .sort((a, b) => dateValue(a.fields.review_due_at) - dateValue(b.fields.review_due_at));
  const newCandidates = words
    .filter((word) => isNewWord(word))
    .sort((a, b) => dateValue(a.fields.first_used_at) - dateValue(b.fields.first_used_at));
  const newWordIds = newCandidates.slice(0, Math.max(0, quota - introducedToday)).map((word) => word.id);
  const interleaved = interleaveWords(due.map((word) => word.id), newWordIds, options.seed ?? "");
  return {
    dueWordIds: due.map((word) => word.id),
    newWordIds,
    sessionWordIds: interleaved.slice(0, cap),
    remainingWordIds: interleaved.slice(cap),
    quota,
    introducedToday,
    newAvailable: newCandidates.length
  };
}

// Spreads new cards evenly among due reviews, deterministically.
export function interleaveWords(dueWordIds: string[], newWordIds: string[], seed = "") {
  if (!newWordIds.length) return [...dueWordIds];
  if (!dueWordIds.length) return [...newWordIds];
  const orderedNew = [...newWordIds].sort((a, b) => hashSeed(`${seed}:${a}`) - hashSeed(`${seed}:${b}`));
  const total = dueWordIds.length + orderedNew.length;
  const newPositions = new Set(orderedNew.map((_, index) => Math.round(((index + 1) * total) / (orderedNew.length + 1)) - 1));
  const merged: string[] = [];
  let dueIndex = 0;
  let newIndex = 0;
  for (let position = 0; position < total; position += 1) {
    if (newPositions.has(position) && newIndex < orderedNew.length) {
      merged.push(orderedNew[newIndex]);
      newIndex += 1;
    } else {
      merged.push(dueWordIds[dueIndex]);
      dueIndex += 1;
    }
  }
  return merged;
}

// New cards introduced today count only completed/active daily sessions started
// in the local day (abandoned sessions do not burn quota).
export function countNewCardsIntroducedToday<T extends TeableRecord<DailyQueueSessionFields>>(
  sessions: T[],
  scope: { userId: string; profileId?: string },
  options: { now?: Date; timeZone?: string } = {}
) {
  const dayStart = localDayBounds(options.now ?? new Date(), options.timeZone ?? "UTC").start;
  return sessions
    .filter((session) => session.fields.type === "flashcards"
      && (session.fields.status === "completed" || session.fields.status === "active")
      && session.fields.user_id === scope.userId
      && (!scope.profileId || session.fields.language_profile_id === scope.profileId)
      && dateValue(session.fields.started_at || session.fields.created_at) >= dayStart)
    .reduce((total, session) => {
      const focus = parseSessionFocus(session.fields.focus);
      return total + (focus.queueKind === "daily" ? Math.max(0, Math.round(Number(focus.newCardsIntroduced) || 0)) : 0);
    }, 0);
}

export function summarizeDailyQueue<W extends TeableRecord<DailyQueueWordFields>, S extends TeableRecord<DailyQueueSessionFields>>(
  words: W[],
  sessions: S[],
  scope: { userId: string; profileId?: string },
  options: { quota?: number; now?: Date; timeZone?: string; sessionCap?: number } = {}
): DailyQueueSummary {
  const now = options.now ?? new Date();
  const introducedToday = countNewCardsIntroducedToday(sessions, scope, { ...options, now });
  const queue = computeDailyQueue(words, { ...options, now, introducedToday, seed: `${scope.userId}:${localDayStamp(now, options.timeZone ?? "UTC")}` });
  return {
    dueCount: queue.dueWordIds.length,
    newCount: queue.newWordIds.length,
    sessionCardCount: queue.sessionWordIds.length,
    remainingCount: queue.remainingWordIds.length,
    newAvailable: queue.newAvailable,
    introducedToday,
    quota: queue.quota,
    estimatedMinutes: queue.sessionWordIds.length ? Math.max(1, Math.ceil(queue.sessionWordIds.length / 5)) : 0,
    difficultCount: selectDifficultWords(words).length
  };
}

export function selectDifficultWords<T extends TeableRecord<DailyQueueWordFields>>(words: T[], cap = DAILY_SESSION_CAP): T[] {
  return words
    .filter((word) => word.fields.review_state === "difficult" || Boolean(word.fields.leech_flagged_at))
    .sort((a, b) => Number(b.fields.lapse_count ?? 0) - Number(a.fields.lapse_count ?? 0) || dateValue(a.fields.review_due_at) - dateValue(b.fields.review_due_at))
    .slice(0, cap);
}

function localDayBounds(now: Date, timeZone: string) {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = zonedParts(now, zone);
  const day = { year: local.year, month: local.month, day: local.day };
  return {
    start: zonedDateTimeToUtc({ ...day, hour: 0, minute: 0, second: 0 }, zone).getTime(),
    end: zonedDateTimeToUtc({ ...day, hour: 23, minute: 59, second: 59 }, zone).getTime()
  };
}

function localDayStamp(now: Date, timeZone: string) {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const local = zonedParts(now, zone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

function parseSessionFocus(value: string | undefined): { queueKind?: string; newCardsIntroduced?: number } {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as { queueKind?: string; newCardsIntroduced?: number } : {};
  } catch {
    return {};
  }
}

function isValidTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function dateValue(value: string | undefined) {
  const time = value ? Date.parse(value) : 0;
  return Number.isNaN(time) ? 0 : time;
}
```

- [ ] **Step 6: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/daily-queue.test.ts`
Expected: PASS (todos os describes)

- [ ] **Step 7: Commit**

```bash
git add lib/learning/daily-queue.ts lib/learning/spaced-repetition.ts lib/learning/flashcard-contracts.ts tests/unit/daily-queue.test.ts
git commit -m "feat(review): add daily review queue core (quota, interleaving, session cap)"
```

---

### Task 2: Quota configurável do usuário (`daily_new_cards_quota`)

**Files:**
- Modify: `lib/learning/profile.ts:6-13` (`UserFields` + helper)
- Modify: `lib/learning/account.ts:29-33,58-64,90-112`
- Modify: `app/api/profile/route.ts` (PATCH passthrough)
- Create: `scripts/ensure-daily-queue-fields.mjs`
- Modify: `package.json` (script de migração)
- Test: `tests/unit/personal-user.test.ts`

**Interfaces:**
- Consumes: `normalizeNewCardsQuota` (Task 1).
- Produces: `getDailyNewCardsQuota(user: TeableRecord<UserFields>): number` (profile.ts) — usado pelas Tasks 3 e 5; `ProfileInput.dailyNewCardsQuota?: number` aceito pelo PATCH `/api/profile`; `getProfileSettings().user.dailyNewCardsQuota`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/unit/personal-user.test.ts` (manter o estilo de factory do arquivo):

```ts
describe("getDailyNewCardsQuota", () => {
  it("defaults to 10 when the field is missing or invalid", () => {
    expect(getDailyNewCardsQuota({ id: "u1", fields: {} })).toBe(10);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: Number("x") } })).toBe(10);
  });

  it("clamps to the supported range", () => {
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 0 } })).toBe(0);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 25 } })).toBe(25);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 500 } })).toBe(50);
  });
});
```

Adicionar o import no topo do arquivo: `import { getDailyNewCardsQuota } from "../../lib/learning/profile";` (fundir com o import existente de `profile`, se houver).

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/personal-user.test.ts`
Expected: FAIL — `getDailyNewCardsQuota is not exported`

- [ ] **Step 3: Implementar helper em profile.ts**

Em `lib/learning/profile.ts`:

1. Adicionar ao topo: `import { normalizeNewCardsQuota } from "./daily-queue";`
2. Estender `UserFields`:

```ts
export type UserFields = {
  Name?: string;
  name?: string;
  avatar_url?: string;
  active_language_id?: string;
  timezone?: string;
  daily_new_cards_quota?: number;
  created_at?: string;
};
```

3. Adicionar após `getOrCreatePersonalUser`:

```ts
export function getDailyNewCardsQuota(user: TeableRecord<UserFields>) {
  return normalizeNewCardsQuota(user.fields.daily_new_cards_quota);
}
```

- [ ] **Step 4: Aceitar a quota no PATCH /api/profile**

Em `lib/learning/account.ts`:

1. Estender o tipo:

```ts
type ProfileInput = {
  name?: string;
  timezone?: string;
  activeLanguageId?: string;
  dailyNewCardsQuota?: number;
};
```

2. Adicionar import: `import { getDailyNewCardsQuota } from "./profile";` (fundir com o import existente de `./profile`).
3. Em `updatePersonalProfile`, após o bloco de `activeLanguageId` (linha ~106), adicionar:

```ts
  if (typeof input.dailyNewCardsQuota === "number") {
    if (!Number.isFinite(input.dailyNewCardsQuota)) throw new AccountValidationError("Quota diária inválida.");
    fields.daily_new_cards_quota = Math.min(50, Math.max(0, Math.round(input.dailyNewCardsQuota)));
  }
```

4. Em `getProfileSettings`, no objeto `user`, adicionar a linha após `activeLanguageId`:

```ts
      dailyNewCardsQuota: getDailyNewCardsQuota(user)
```

Em `app/api/profile/route.ts`, no PATCH, adicionar ao objeto passado a `updatePersonalProfile`:

```ts
      dailyNewCardsQuota: typeof body.dailyNewCardsQuota === "number" ? body.dailyNewCardsQuota : undefined
```

- [ ] **Step 5: Script de migração aditiva**

Criar `scripts/ensure-daily-queue-fields.mjs`:

```js
import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const FIELD_PLAN = [
  {
    envName: "TEABLE_USERS_TABLE_ID",
    fields: [
      { type: "number", name: "daily_new_cards_quota", description: "Daily review queue: max new cards introduced per day (default 10)." }
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

Em `package.json`, junto de `review:srs-v2-fields`, adicionar:

```json
"review:daily-queue-fields": "node scripts/ensure-daily-queue-fields.mjs"
```

- [ ] **Step 6: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/personal-user.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/learning/profile.ts lib/learning/account.ts app/api/profile/route.ts scripts/ensure-daily-queue-fields.mjs package.json tests/unit/personal-user.test.ts
git commit -m "feat(review): configurable daily new-cards quota on user settings"
```

---

### Task 3: `queueKind` no servidor + resumo da fila no GET

**Files:**
- Modify: `lib/learning/flashcard-contracts.ts` (`flashcardQueueKinds`, `FlashcardQueueKind`)
- Modify: `lib/learning/flashcards.ts:112-122,129-131,188-262` (PracticeFocus, normalize, seleção por queueKind, focus JSON)
- Modify: `app/api/practice/flashcards/route.ts` (GET retorna `dailyQueue`)
- Test: `tests/unit/flashcards.test.ts`

**Interfaces:**
- Consumes: `computeDailyQueue`, `countNewCardsIntroducedToday`, `selectDifficultWords`, `summarizeDailyQueue`, `DailyQueueSummary` (Task 1); `getDailyNewCardsQuota` (Task 2).
- Produces:
  - `flashcardQueueKinds = ["daily", "custom", "difficult"]`, `type FlashcardQueueKind` (contracts)
  - `normalizeFlashcardQueueKind(value: unknown): FlashcardQueueKind | null` (flashcards.ts)
  - `createFlashcardPractice(input)` passa a aceitar `queueKind?: unknown`; grava no `focus` JSON: `queueKind`, e para daily `newCardsIntroduced: number` e `dailyQuota: number`
  - `getDailyQueueSummary(): Promise<DailyQueueSummary | null>` (flashcards.ts)
  - GET `/api/practice/flashcards` retorna `{ ok, activeSession, dailyQueue }`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `tests/unit/flashcards.test.ts` (importar `normalizeFlashcardQueueKind` de `../../lib/learning/flashcards`):

```ts
describe("flashcard queue kinds", () => {
  it("normalizes explicit queue kinds and rejects unknown values", () => {
    expect(normalizeFlashcardQueueKind("daily")).toBe("daily");
    expect(normalizeFlashcardQueueKind("custom")).toBe("custom");
    expect(normalizeFlashcardQueueKind("difficult")).toBe("difficult");
    expect(normalizeFlashcardQueueKind("weird")).toBeNull();
    expect(normalizeFlashcardQueueKind(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/flashcards.test.ts`
Expected: FAIL — `normalizeFlashcardQueueKind is not exported`

- [ ] **Step 3: Tipos em flashcard-contracts.ts**

Adicionar após `FlashcardCriterion`:

```ts
export const flashcardQueueKinds = ["daily", "custom", "difficult"] as const;
export type FlashcardQueueKind = (typeof flashcardQueueKinds)[number];
```

- [ ] **Step 4: Seleção por queueKind em flashcards.ts**

1. Imports: adicionar `getDailyNewCardsQuota` ao import de `./profile`; adicionar

```ts
import { computeDailyQueue, countNewCardsIntroducedToday, selectDifficultWords, summarizeDailyQueue } from "./daily-queue";
```

e `flashcardQueueKinds, type FlashcardQueueKind` ao import de `./flashcard-contracts`.

2. Estender `PracticeFocus` (linha ~112):

```ts
type PracticeFocus = {
  criterion?: FlashcardCriterion;
  queueKind?: FlashcardQueueKind;
  wordIds: string[];
  cardCount?: number;
  deckSeed?: string;
  cards?: Flashcard[];
  newCardsIntroduced?: number;
  dailyQuota?: number;
  completed?: boolean;
  completionId?: string;
  result?: StoredFlashcardResult;
  [key: string]: unknown;
};
```

3. Adicionar após `normalizeFlashcardCriterion`:

```ts
export function normalizeFlashcardQueueKind(value: unknown): FlashcardQueueKind | null {
  return flashcardQueueKinds.includes(value as FlashcardQueueKind) ? value as FlashcardQueueKind : null;
}
```

4. Em `createFlashcardPractice` (linha ~188): mudar a assinatura para

```ts
export async function createFlashcardPractice(input: { criterion?: unknown; count?: unknown; wordIds?: unknown; parentSessionId?: unknown; retrainMode?: unknown; queueKind?: unknown }) {
```

5. Substituir a linha da seleção (`const selected = ...`, linha ~208) pelo bloco abaixo. O `requestedWordIds` já existe logo acima; a resolução do kind garante back-compat (requisições antigas com `criterion`/`count` viram `custom`):

```ts
  const queueKind: FlashcardQueueKind = normalizeFlashcardQueueKind(input.queueKind)
    ?? (requestedWordIds?.size || input.criterion !== undefined || input.count !== undefined ? "custom" : "daily");
  const timeZone = user.fields.timezone ?? "UTC";
  let selected: typeof scoped;
  let newCardsIntroduced = 0;
  let dailyQuota: number | undefined;
  if (requestedWordIds?.size) {
    selected = scoped.filter((word) => requestedWordIds.has(word.id));
  } else if (queueKind === "daily") {
    dailyQuota = getDailyNewCardsQuota(user);
    const introducedToday = countNewCardsIntroducedToday(sessions, { userId: user.id, profileId: profile.id }, { timeZone });
    const queue = computeDailyQueue(scoped, {
      quota: dailyQuota,
      introducedToday,
      timeZone,
      seed: `${user.id}:${new Date().toISOString().slice(0, 10)}`
    });
    if (!queue.sessionWordIds.length) throw new LearningStateError("Fila de hoje vazia. Volte amanhã para novas palavras ou monte uma sessão custom.", 409);
    const wordsById = new Map(scoped.map((word) => [word.id, word]));
    selected = queue.sessionWordIds.map((id) => wordsById.get(id)!);
    newCardsIntroduced = selected.filter((word) => queue.newWordIds.includes(word.id)).length;
  } else if (queueKind === "difficult") {
    selected = selectDifficultWords(scoped);
    if (!selected.length) throw new LearningStateError("Nenhuma palavra difícil no momento. Continue a fila diária para encontrar novos desafios.", 409);
  } else {
    selected = selectFlashcardWords(scoped, criterion, requestedCount);
  }
```

(O `throw` genérico `selected.length < 1` existente logo abaixo permanece — cobre o caso `custom` sem palavras.)

6. No `createRecord` de `practiceSessions`, trocar o campo `focus` por:

```ts
    focus: JSON.stringify({
      criterion,
      queueKind,
      wordIds: selected.map((word) => word.id),
      ...(queueKind === "daily" ? { newCardsIntroduced, dailyQuota } : {}),
      retrainMode: typeof input.retrainMode === "string" ? input.retrainMode : undefined
    }),
```

7. Adicionar a função de resumo após `getActiveFlashcardPractice`:

```ts
export async function getDailyQueueSummary() {
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const [allWords, sessions] = await Promise.all([
    client.listRecords<WordFields>("words", 500),
    client.listRecords<PracticeSessionFields>("practiceSessions", 300)
  ]);
  const scoped = allWords.filter((word) => matchesLearningScope(word.fields, { userId: user.id, profileId: profile.id }));
  return summarizeDailyQueue(scoped, sessions, { userId: user.id, profileId: profile.id }, {
    quota: getDailyNewCardsQuota(user),
    timeZone: user.fields.timezone ?? "UTC"
  });
}
```

- [ ] **Step 5: GET da rota retorna o resumo**

Em `app/api/practice/flashcards/route.ts`:

```ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createFlashcardPractice, getActiveFlashcardPractice, getDailyQueueSummary } from "@/lib/learning/flashcards";

export async function GET() {
  try {
    const [activeSession, dailyQueue] = await Promise.all([getActiveFlashcardPractice(), getDailyQueueSummary()]);
    return jsonOk({ ok: true, activeSession, dailyQueue });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { criterion?: unknown; count?: unknown; queueKind?: unknown };
    return jsonOk({ ok: true, ...(await createFlashcardPractice(body)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 6: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/flashcards.test.ts tests/unit/daily-queue.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/learning/flashcard-contracts.ts lib/learning/flashcards.ts app/api/practice/flashcards/route.ts tests/unit/flashcards.test.ts
git commit -m "feat(review): server-side daily queue kind with new-cards quota accounting"
```

---

### Task 4: Tela inicial do trainer (fila do dia + Começar)

**Files:**
- Modify: `components/FlashcardTrainer.tsx`
- Test: `tests/e2e/qa-flow.spec.ts` (ajustar 3 testes existentes; o teste novo do fluxo diário é a Task 6)

**Interfaces:**
- Consumes: GET `/api/practice/flashcards` → `{ ok, activeSession, dailyQueue: DailyQueueSummary | null }`; POST com `{ queueKind }` (daily/difficult) ou `{ queueKind: "custom", criterion, count }`; PATCH `/api/profile` `{ dailyNewCardsQuota }`; tipos `DailyQueueSummary`, `FlashcardQueueKind` (Tasks 1–3).
- Produces: tela inicial com "Fila de hoje" (X revisões + Y novas · ~N min), botão **Começar revisão de hoje**, stepper "Novas por dia", botão "Só difíceis (N)" (só se houver), e seção "Sessão custom" colapsável com o critério/slider atuais.

- [ ] **Step 1: Estado e carregamento do overview**

Em `components/FlashcardTrainer.tsx`:

1. Import — trocar a linha de tipos de `flashcard-contracts` por:

```ts
import type { AnswerMatch, DailyQueueSummary, Flashcard, FlashcardAnswer, FlashcardCriterion, FlashcardPracticeResult, FlashcardQueueKind, QueueItem, RecallRating } from "@/lib/learning/flashcard-contracts";
```

2. Estados — adicionar junto dos demais `useState`:

```ts
  const [dailyQueue, setDailyQueue] = useState<DailyQueueSummary | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [quotaSaving, setQuotaSaving] = useState(false);
```

3. Substituir o `useEffect` do GET inicial (linhas 61-66) por:

```ts
  async function loadOverview() {
    try {
      const response = await fetch("/api/practice/flashcards", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; activeSession?: typeof resumable; dailyQueue?: DailyQueueSummary | null };
      if (response.ok && data.ok) {
        if (data.activeSession) setResumable(data.activeSession);
        setDailyQueue(data.dailyQueue ?? null);
      }
    } catch { /* overview é best-effort; a sessão custom continua disponível */ }
  }

  useEffect(() => {
    void loadOverview();
  }, []);
```

- [ ] **Step 2: `start` por queueKind + stepper de quota**

1. Substituir a função `start()` (linhas 72-82) por:

```ts
  async function start(queueKind: FlashcardQueueKind) {
    setBusy(true); setError("");
    try {
      const body = queueKind === "custom" ? { queueKind, criterion, count } : { queueKind };
      const response = await fetch("/api/practice/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { ok?: boolean; error?: string; sessionId?: string; cards?: Flashcard[]; languageCode?: string; languageName?: string; adapted?: boolean };
      if (!response.ok || !data.ok || !data.sessionId || !data.cards?.length) throw new Error(data.error ?? "Não foi possível montar o treino.");
      const initialQueue = createFlashcardQueue(data.cards);
      setSessionId(data.sessionId); setCompletionId(crypto.randomUUID()); setCards(data.cards); setQueue(initialQueue); setCurrentItem(selectNextQueueItem(initialQueue, 0)); setLanguageCode(data.languageCode ?? "es"); setLanguageName(data.languageName ?? "idioma estudado"); setAdapted(data.adapted === true); setResumable(null); setAnswers([]); setResult(null); resetAttempt();
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Não foi possível montar o treino."); }
    finally { setBusy(false); }
  }

  async function changeQuota(delta: number) {
    if (!dailyQueue || quotaSaving) return;
    const next = Math.max(0, Math.min(50, dailyQueue.quota + delta));
    if (next === dailyQueue.quota) return;
    setQuotaSaving(true);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyNewCardsQuota: next }) });
      if (response.ok) await loadOverview();
    } catch { /* mantém a quota anterior na tela */ }
    finally { setQuotaSaving(false); }
  }
```

2. Em `restartSession`, a chamada `await start()` vira `await start("daily")`.
3. No botão "Novo treino" (tela de resultado, linha ~197), o `onClick` vira:

```tsx
onClick={() => { setCards([]); setResult(null); void loadOverview(); }}
```

- [ ] **Step 3: Nova tela inicial (JSX)**

Substituir todo o `return` final do componente (linhas 245-254, o bloco que começa `return <div className="flashcard-screen">` com `flashcard-intro`) por:

```tsx
  return <div className="flashcard-screen">
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-intro"><div className="flashcard-brand"><Brain /></div><div><div className="eyebrow">Revisão inteligente</div><h1 className="title">Treino de cards</h1><p className="subtitle">Recupere a palavra da memória antes de conferir a resposta.</p></div></section>
    {resumable?.currentItem ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="resume-training-title" aria-modal="true" className="confirmation-modal" role="dialog"><RotateCcw /><h2 className="section-title" id="resume-training-title">Treino em andamento</h2><p className="row-meta">Você já concluiu {resumable.attempts.length} apresentações. Escolha como seguir.</p><div className="flashcard-resume-actions"><button className="green-button" disabled={busy} onClick={continueSession} type="button">Continuar treino</button><button className="outline-button" disabled={busy} onClick={() => void restartSession()} type="button">Reiniciar treino</button><button className="danger-button" disabled={busy} onClick={() => void abandonSession(resumable.sessionId)} type="button">Abandonar</button></div></section></div> : null}
    {dailyQueue ? <section className="section flashcard-daily" aria-label="Fila de hoje">
      <h2 className="section-title">Fila de hoje</h2>
      {dailyQueue.sessionCardCount > 0 ? <>
        <p className="row-meta">{dailyQueue.dueCount} revisões + {dailyQueue.newCount} novas · ~{dailyQueue.estimatedMinutes} min{dailyQueue.remainingCount > 0 ? ` · +${dailyQueue.remainingCount} continuam depois` : ""}</p>
        <button className="green-button full-button" disabled={busy} onClick={() => void start("daily")} type="button">{busy ? <Loader2 className="spin" /> : <Brain />} Começar revisão de hoje</button>
      </> : <p className="row-meta">{dailyQueue.introducedToday > 0 ? "Fila de hoje concluída. Amanhã há mais — ou pratique abaixo." : "Nada na fila de hoje. Converse para salvar palavras novas ou monte uma sessão custom."}</p>}
      <div className="top-row row-meta">
        <span>Novas por dia</span>
        <span>
          <button aria-label="Diminuir novas por dia" className="outline-button" disabled={quotaSaving || dailyQueue.quota <= 0} onClick={() => void changeQuota(-1)} type="button">−</button>
          <strong> {dailyQueue.quota} </strong>
          <button aria-label="Aumentar novas por dia" className="outline-button" disabled={quotaSaving || dailyQueue.quota >= 50} onClick={() => void changeQuota(1)} type="button">+</button>
        </span>
      </div>
    </section> : null}
    {dailyQueue && dailyQueue.difficultCount > 0 ? <button className="outline-button full-button" disabled={busy} onClick={() => void start("difficult")} type="button">Só difíceis ({dailyQueue.difficultCount})</button> : null}
    <button className="outline-button full-button" onClick={() => setCustomOpen((open) => !open)} type="button">Sessão custom</button>
    {customOpen ? <>
      <section className="section"><h2 className="section-title">Quais palavras priorizar?</h2><p className="row-meta">Palavras com revisão vencida sempre entram primeiro; o critério ordena o restante.</p><div className="flashcard-choice-grid"><button className={criterion === "least_used" ? "choice-card active" : "choice-card"} onClick={() => setCriterion("least_used")} type="button"><Layers3 /><div><strong>Menos usadas</strong><span>Reforça palavras com pouca prática</span></div></button><button className={criterion === "oldest" ? "choice-card active" : "choice-card"} onClick={() => setCriterion("oldest")} type="button"><Clock3 /><div><strong>Há mais tempo sem usar</strong><span>Recupera vocabulário esquecido</span></div></button></div></section>
      <section className="section"><div className="top-row"><h2 className="section-title">Quantidade de palavras</h2><strong>{count}</strong></div><input aria-label="Quantidade de palavras" className="flashcard-range" min="2" max="30" onChange={(event) => setCount(Number(event.target.value))} step="1" type="range" value={count} /><div className="top-row row-meta"><span>2</span><span>30</span></div></section>
      <div className="soft-card"><Sparkles /><div><strong>Como funciona</strong><p className="row-meta">Digite ou fale sua tentativa. A resposta só aparece depois, e você confirma a avaliação sugerida.</p></div></div>
      <button className="green-button full-button" disabled={busy} onClick={() => void start("custom")} type="button">{busy ? <Loader2 className="spin" /> : <Brain />} Montar treino com {count} palavras</button>
    </> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
```

(As seções de critério/slider são as mesmas de antes, apenas movidas para dentro de `customOpen`.)

- [ ] **Step 4: Ajustar os 3 testes e2e existentes**

Em `tests/e2e/qa-flow.spec.ts`, nos três testes que clicam em `/Montar treino/` (linhas ~84, ~138 e ~168), inserir imediatamente antes do clique:

```ts
  await page.getByRole("button", { name: "Sessão custom" }).click();
```

(Os mocks de GET desses testes retornam `{ ok: true, activeSession: null }` sem `dailyQueue`, então a seção diária não renderiza e a custom é o caminho disponível.)

- [ ] **Step 5: Rodar typecheck + testes e2e afetados**

Run: `npm run typecheck && npx playwright test tests/e2e/qa-flow.spec.ts -g "flashcard"`
Expected: PASS (3 testes existentes ajustados)

- [ ] **Step 6: Commit**

```bash
git add components/FlashcardTrainer.tsx tests/e2e/qa-flow.spec.ts
git commit -m "feat(review): daily queue intro screen with quota stepper and secondary modes"
```

---

### Task 5: Card da página de palavras + gancho da home

**Files:**
- Modify: `lib/learning/words.ts` (escopo + `dailyQueue` em `getWordsData`)
- Modify: `app/palavras/page.tsx:36`
- Modify: `lib/learning/home.ts:36-48,65-70,159-174` (WordFields local, fetch de sessões, `buildSuggestions`)
- Test: `tests/unit/home-suggestions.test.ts`

**Interfaces:**
- Consumes: `summarizeDailyQueue`, `DailyQueueSessionFields` (Task 1); `getDailyNewCardsQuota` (Task 2).
- Produces: `getWordsData()` retorna `dailyQueue: DailyQueueSummary | null`; `buildSuggestions(topics, feedback, words, dailyQueue?)` aceita 4º parâmetro opcional `{ dueCount, newCount } | null`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `tests/unit/home-suggestions.test.ts`:

```ts
  it("reflects the daily queue in the weak-words hook", () => {
    const suggestions = buildSuggestions([], null, [
      {
        id: "w1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "casa",
          display_text: "casa",
          translation: "house",
          part_of_speech: "noun",
          familiarity_score: 0,
          total_uses: 1,
          last_used_at: "2026-08-01T10:00:00.000Z",
          first_used_at: "2026-07-01T10:00:00.000Z",
          review_due_at: "2026-08-01T09:00:00.000Z"
        }
      }
    ], { dueCount: 3, newCount: 2 });

    expect(suggestions[0]).toMatchObject({ source: "weak_words", meta: "Hoje: 3 revisões + 2 novas na sua fila." });
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/home-suggestions.test.ts`
Expected: FAIL — `meta` atual é "Palavras com revisão pendente no seu vocabulário."

- [ ] **Step 3: `dailyQueue` em getWordsData (words.ts)**

1. Imports: adicionar `import { summarizeDailyQueue, type DailyQueueSessionFields } from "./daily-queue";` e `getDailyNewCardsQuota` ao import de `./profile`.
2. Estender o tipo `WordScope` com `timeZone: string; dailyNewCardsQuota: number;` e, em `getWordScope`, adicionar ao objeto retornado:

```ts
    timeZone: user.fields.timezone ?? "UTC",
    dailyNewCardsQuota: getDailyNewCardsQuota(user)
```

3. Em `getWordsData`, trocar o `Promise.all` inicial por:

```ts
  const [scope, records, sessions] = await Promise.all([
    getWordScope(),
    getWordRecords(),
    getTeableClient().listRecords<DailyQueueSessionFields>("practiceSessions", 300)
  ]);
```

4. Adicionar ao objeto retornado por `getWordsData` (junto de `summary`):

```ts
    dailyQueue: scope.profileId
      ? summarizeDailyQueue(scoped, sessions, { userId: scope.userId, profileId: scope.profileId }, { quota: scope.dailyNewCardsQuota, timeZone: scope.timeZone })
      : null
```

- [ ] **Step 4: Card "Revisão inteligente" na página de palavras**

Em `app/palavras/page.tsx` (linha 36), trocar o texto fixo `Palavras e frases do seu vocabulário` por:

```tsx
<div className="row-meta">{data.dailyQueue && data.dailyQueue.dueCount + data.dailyQueue.newCount > 0 ? `Hoje: ${data.dailyQueue.dueCount} revisões + ${data.dailyQueue.newCount} novas` : "Palavras e frases do seu vocabulário"}</div>
```

- [ ] **Step 5: Gancho da home (home.ts)**

1. Estender o `WordFields` local (linhas 36-48) com os campos de revisão usados pela fila:

```ts
export type WordFields = {
  user_id: string;
  language_profile_id: string;
  lemma: string;
  display_text: string;
  translation: string;
  part_of_speech: string;
  familiarity_score: number;
  total_uses: number;
  last_used_at: string;
  first_used_at: string;
  review_due_at: string;
  last_reviewed_at?: string;
  review_state?: string;
  leech_flagged_at?: string;
  lapse_count?: number;
};
```

2. Imports: adicionar `import { summarizeDailyQueue, type DailyQueueSessionFields } from "./daily-queue";` e `getDailyNewCardsQuota` ao import de `./profile`.
3. Em `getHomeData`, adicionar `client.listAllRecords<DailyQueueSessionFields>("practiceSessions")` como 5º item do `Promise.all` (desestruturar como `sessions`) e, antes do `return`, calcular:

```ts
  const dailyQueue = profile
    ? summarizeDailyQueue(profileWords, sessions, { userId: user.id, profileId: profile.id }, { quota: getDailyNewCardsQuota(user), timeZone: user.fields.timezone ?? "UTC" })
    : null;
```

4. Passar na chamada: `buildSuggestions(profileTopics, profile?.fields.calendar_memory_enabled ? recentFeedback : null, profileWords, dailyQueue)`.
5. Em `buildSuggestions`, adicionar o 4º parâmetro:

```ts
export function buildSuggestions(
  topics: TeableRecord<TopicFields>[],
  feedback: TeableRecord<DailyFeedbackFields> | null,
  words: TeableRecord<WordFields>[],
  dailyQueue?: { dueCount: number; newCount: number } | null
) {
```

e, na `wordSuggestion`, trocar a linha `meta:` por:

```ts
        meta: dailyQueue && dailyQueue.dueCount + dailyQueue.newCount > 0
          ? `Hoje: ${dailyQueue.dueCount} revisões + ${dailyQueue.newCount} novas na sua fila.`
          : "Palavras com revisão pendente no seu vocabulário.",
```

- [ ] **Step 6: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/home-suggestions.test.ts tests/unit/word-strength.test.ts tests/unit/word-search.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/learning/words.ts app/palavras/page.tsx lib/learning/home.ts tests/unit/home-suggestions.test.ts
git commit -m "feat(review): surface daily queue on words page and home hook"
```

---

### Task 6: E2E do fluxo diário + verificação completa

**Files:**
- Test: `tests/e2e/qa-flow.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–5.

- [ ] **Step 1: Escrever o teste e2e do fluxo diário**

Adicionar a `tests/e2e/qa-flow.spec.ts`, após o teste `"mobile flashcard training completes a frozen deck once"`:

```ts
test("daily review queue intro starts a daily session", async ({ page }) => {
  const createBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/practice/flashcards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          activeSession: null,
          dailyQueue: { dueCount: 3, newCount: 2, sessionCardCount: 5, remainingCount: 0, newAvailable: 8, introducedToday: 0, quota: 10, estimatedMinutes: 1, difficultCount: 0 }
        })
      });
      return;
    }
    createBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "session-daily",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-daily", sessionId: "session-daily", type: "target_to_native", targetWordId: "word-a", supportingWordIds: [], prompt: "hola", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", difficulty: 1 }
        ]
      })
    });
  });

  await page.goto("/palavras/treino");
  await expect(page.getByText(/3 revisões \+ 2 novas/)).toBeVisible();
  await page.getByRole("button", { name: "Começar revisão de hoje" }).click();
  await expect(page.getByText("hola", { exact: true })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(createBodies[0]).toEqual({ queueKind: "daily" });
});
```

- [ ] **Step 2: Rodar o e2e de flashcards**

Run: `npx playwright test tests/e2e/qa-flow.spec.ts -g "flashcard|daily"`
Expected: PASS (4 testes)

- [ ] **Step 3: Verificação completa local**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: tudo verde

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/qa-flow.spec.ts
git commit -m "test(review): cover daily queue training flow end to end"
```

- [ ] **Step 5: Runbook operacional (orquestrador, após merge)**

1. `node scripts/ensure-daily-queue-fields.mjs --env .env.qa.local` (dry-run) → conferir `create-required` apenas para `daily_new_cards_quota`.
2. `node scripts/ensure-daily-queue-fields.mjs --env .env.qa.local --apply`.
3. `npm run build` (o servidor QA usa `next start` sobre `.next` — build desatualizado roda código velho) e `npm run test:integration` → 32/32.
4. **Com confirmação do usuário:** `node scripts/ensure-daily-queue-fields.mjs --env .env.local --apply` (produção).

---

## Notas de escopo (o que este PR NÃO faz)

- Não muda tipos de card (mix produção/cloze/escuta é o PR C) nem frases com IA (PR D).
- Não altera o fluxo de tentativa/complete nem o SRS (PR A).
- Selo "precisa de atenção" (leech) na lista de palavras fica para o PR C/D junto da variedade para difíceis; aqui só o modo "Só difíceis" usa `leech_flagged_at`.
