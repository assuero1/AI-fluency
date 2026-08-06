# Avaliação Binária de Flashcards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os 4 botões de autoavaliação dos flashcards por 2 ("Não lembrei" / "Lembrei") com nota interna inferida por acerto + tempo de resposta, adicionar "Desfazer" com snapshot de revisão, e auditar todos os recursos de flashcard com testes.

**Architecture:** A matemática do SRS v2 (`lib/learning/spaced-repetition.ts`) não muda. O servidor passa a decidir a nota de 4 valores a partir de uma decisão binária do usuário (`resolveBinaryRating` em `lib/learning/flashcard-queue.ts`). Um novo endpoint `preview` devolve os intervalos exatos dos 2 botões (agora o tempo de resposta é conhecido). O undo restaura um snapshot JSON dos campos de revisão gravado em cada tentativa (`flashcardAttempts`).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Vitest (unit), Playwright (e2e), Teable como banco.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-06-flashcard-binary-rating-design.md`.
- Copy de UI em pt-BR; comentários de código em inglês (padrão do projeto).
- Nenhuma mudança destrutiva de schema no Teable — apenas campos aditivos via scripts `scripts/ensure-*.mjs` (dry-run primeiro, `--apply` depois).
- Após cada task: `npm run lint && npm run typecheck && npm run test:unit` devem passar.
- Commits pequenos por task, mensagens em inglês no padrão conventional (`feat:`, `fix:`, `test:`, `docs:`).
- NÃO modificar `lib/learning/spaced-repetition.ts` exceto na Task 8 (remoção de `previewReviewIntervals`).

---

### Task 1: Auditoria de linha de base dos flashcards

**Files:**
- Test: `tests/unit/daily-queue.test.ts`, `tests/unit/flashcards.test.ts`, `tests/unit/spaced-repetition.test.ts`, `tests/unit/flashcard-queue.test.ts`, `tests/unit/flashcard-completion.test.ts`, `tests/unit/flashcard-persistence.test.ts` (todos existentes — só adicionar onde houver lacuna)
- Create: `docs/FLASHCARD_AUDIT_2026-08-06.md`

**Interfaces:**
- Consome: nada (task de verificação).
- Produz: relatório de auditoria; testes de caracterização novos (se houver lacunas) que as tasks seguintes não podem quebrar.

- [ ] **Step 1: Rodar a linha de base**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: tudo verde. Se algo falhar, PARAR e reportar ao usuário antes de qualquer mudança (a falha pré-existe e pode ser o bug que a auditoria procura).

- [ ] **Step 2: Verificar cobertura do checklist**

Para cada comportamento abaixo, procurar nos arquivos de teste existentes um teste que o cubra (grep por nomes de função). Marcar ✅ (coberto) ou ❌ (lacuna) no relatório:

1. `computeDailyQueue` (`lib/learning/daily-queue.ts:51-76`): vencidas até fim do dia no fuso; novas = `last_reviewed_at` vazio ordenadas por `first_used_at`; quota `max(0, quota - introducedToday)`; interleaving; cap 30 e `remainingWordIds`.
2. `countNewCardsIntroducedToday` (`daily-queue.ts:~100-110`): só sessões `completed`/`active` contam.
3. `selectDifficultWords` (`daily-queue.ts:142-147`): `difficult` ou leech; ordenação `lapse_count` desc, `review_due_at` asc; cap 30.
4. `selectFlashcardWords` (`lib/learning/flashcards.ts:162-174`): vencidas primeiro, clamp aplicado por `normalizeFlashcardCount` (2–30, `flashcards.ts:158-160`).
5. `advanceFlashcardQueue` / `selectNextQueueItem` / `rebuildFlashcardQueue` (`lib/learning/flashcard-queue.ts`): +3/+5, máx. 3 apresentações, retomada.
6. `calculateAdaptiveReview` (`lib/learning/spaced-repetition.ts`): passos [1,3], graduação 7/15, regraduação pós-lapse ×0.5/×0.75 piso 4, ease 1.3–2.8, leech ≥ 4, fuzz ±10% ≥ 7 dias determinístico.
7. `validateFlashcardAnswers` (`flashcards.ts:176-201`): 1–3 apresentações por card, ordem, resposta vazia.
8. Incremental review + `review_applied` (coberto por `flashcard-persistence.test.ts`).

- [ ] **Step 3: Adicionar testes apenas nas lacunas**

Exemplo de teste de caracterização (adicionar em `tests/unit/flashcards.test.ts` se `selectFlashcardWords` não tiver cobertura de partição; seguir o estilo de construção de registros já usado nesse arquivo):

```ts
it("selectFlashcardWords puts due words first and orders the rest by due date", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const word = (id: string, fields: Record<string, unknown>) => ({ id, fields }) as never;
  const words = [
    word("upcoming", { total_uses: 1, review_due_at: "2026-08-10T09:00:00.000Z" }),
    word("due", { total_uses: 99, review_due_at: "2026-08-01T09:00:00.000Z" }),
    word("never-scheduled", { total_uses: 5 })
  ];
  const selected = selectFlashcardWords(words, "least_used", 3, now);
  expect(selected.map((item) => (item as { id: string }).id)).toEqual(["never-scheduled", "due", "upcoming"]);
});
```

(Nota: "never-scheduled" conta como vencida e, entre as vencidas, o critério ordena — `total_uses` 5 < 99. Se a ordenação observada for diferente, documentar o comportamento REAL no relatório, não "corrigir" o teste para a expectativa desejada.)

- [ ] **Step 4: Escrever o relatório**

`docs/FLASHCARD_AUDIT_2026-08-06.md`: para cada item do checklist — comportamento esperado (com `arquivo:linha`), teste que cobre (ou "lacuna → teste adicionado"), e bugs encontrados. Bugs claros de implementação: corrigir em commit separado `fix:`. Discrepâncias que mudem comportamento visível: NÃO corrigir — listar na seção "Decisões pendentes" do relatório.

- [ ] **Step 5: Commit**

```bash
git add tests/unit docs/FLASHCARD_AUDIT_2026-08-06.md
git commit -m "test: characterization coverage for flashcard audit baseline"
```

---

### Task 2: `inferRecallRating` + `resolveBinaryRating`

**Files:**
- Modify: `lib/learning/flashcard-queue.ts` (rename + nova função)
- Modify: `lib/learning/flashcards.ts:12,488` (import e call site)
- Test: `tests/unit/flashcard-queue.test.ts`

**Interfaces:**
- Produz (usado pelas Tasks 4, 5 e 7):
  - `inferRecallRating(input: { match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating` — mesma lógica da antiga `suggestRecallRating`.
  - `resolveBinaryRating(input: { remembered: boolean; match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating`

- [ ] **Step 1: Reescrever os testes (falhando)**

Em `tests/unit/flashcard-queue.test.ts`, trocar o import para `inferRecallRating, resolveBinaryRating` e substituir o primeiro teste por:

```ts
it("infers ratings from match and response time", () => {
  expect(inferRecallRating({ match: "incorrect", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("forgot");
  expect(inferRecallRating({ match: "minor_error", forgot: false, responseTimeMs: 1000, cardType: "native_to_target" })).toBe("hard");
  expect(inferRecallRating({ match: "exact", forgot: false, responseTimeMs: 3000, cardType: "native_to_target" })).toBe("easy");
  expect(inferRecallRating({ match: "exact", forgot: false, responseTimeMs: 9000, cardType: "native_to_target" })).toBe("good");
});

it("resolves the binary choice into a 4-value rating", () => {
  const base = { responseTimeMs: 1000, cardType: "native_to_target" } as const;
  expect(resolveBinaryRating({ ...base, remembered: false, match: "exact", forgot: false })).toBe("forgot");
  expect(resolveBinaryRating({ ...base, remembered: true, match: "incorrect", forgot: false })).toBe("hard");
  expect(resolveBinaryRating({ ...base, remembered: true, match: "incorrect", forgot: true })).toBe("hard");
  expect(resolveBinaryRating({ ...base, remembered: true, match: "minor_error", forgot: false })).toBe("hard");
  expect(resolveBinaryRating({ ...base, remembered: true, match: "exact", forgot: false })).toBe("easy");
  expect(resolveBinaryRating({ ...base, remembered: true, match: "exact", forgot: false, responseTimeMs: 9000 })).toBe("good");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/flashcard-queue.test.ts`
Expected: FAIL (`inferRecallRating is not exported`).

- [ ] **Step 3: Implementar**

Em `lib/learning/flashcard-queue.ts`, renomear `suggestRecallRating` → `inferRecallRating` e adicionar:

```ts
// Binary UI: the user only says "remembered" or not; the 4-value rating is inferred.
// A wrong/forgotten answer the user claims to know counts as "hard" (typed slip), never good/easy.
export function resolveBinaryRating(input: { remembered: boolean; match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating {
  if (!input.remembered) return "forgot";
  if (input.forgot || input.match === "incorrect") return "hard";
  return inferRecallRating(input);
}
```

- [ ] **Step 4: Atualizar call sites**

`lib/learning/flashcards.ts:12` — trocar `suggestRecallRating` por `inferRecallRating` no import; linha 488 — trocar a chamada e o nome da variável local `suggestedRating` → `inferredRating` (o campo gravado `suggested_rating` no Teable NÃO muda). `components/FlashcardTrainer.tsx` será atualizado na Task 7 — por agora, manter o build verde ajustando só o import/uso (troca mecânica de nome).

- [ ] **Step 5: Verificar + commit**

Run: `npx vitest run tests/unit/flashcard-queue.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add lib/learning/flashcard-queue.ts lib/learning/flashcards.ts components/FlashcardTrainer.tsx tests/unit/flashcard-queue.test.ts
git commit -m "refactor: rename suggestRecallRating to inferRecallRating, add resolveBinaryRating"
```

---

### Task 3: Campos de undo no Teable (`review_snapshot`, `undone_at`)

**Files:**
- Create: `scripts/ensure-flashcard-undo-fields.mjs`
- Modify: `package.json` (script `review:undo-fields`)
- Modify: `lib/learning/flashcards.ts:73-94` (tipo `FlashcardAttemptFields`)

**Interfaces:**
- Produz: campos `review_snapshot?: string` (JSON) e `undone_at?: string` (ISO) em `FlashcardAttemptFields`, usados pelas Tasks 4 e 6.

- [ ] **Step 1: Criar o script**

Copiar a estrutura de `scripts/ensure-daily-queue-fields.mjs`, trocando o `FIELD_PLAN`:

```js
const FIELD_PLAN = [
  {
    envName: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
    fields: [
      { type: "text", name: "review_snapshot", description: "JSON snapshot of the affected words' review fields before this attempt's incremental review (for undo)." },
      { type: "text", name: "undone_at", description: "ISO timestamp when this attempt was undone; undone attempts are excluded from queue rebuild and completion." }
    ]
  }
];
```

Adicionar em `package.json` scripts: `"review:undo-fields": "node scripts/ensure-flashcard-undo-fields.mjs"`.

- [ ] **Step 2: Estender o tipo**

Em `lib/learning/flashcards.ts`, tipo `FlashcardAttemptFields` (linha 73-94), adicionar:

```ts
  review_snapshot?: string;
  undone_at?: string;
```

- [ ] **Step 3: Dry-run e apply**

Run: `node scripts/ensure-flashcard-undo-fields.mjs` (dry-run — esperado `create-required` para os 2 campos)
Run: `node scripts/ensure-flashcard-undo-fields.mjs --apply`
Expected: `fieldExists: true` para ambos. Se o dry-run mostrar que já existem, seguir sem apply.

- [ ] **Step 4: Commit**

```bash
git add scripts/ensure-flashcard-undo-fields.mjs package.json lib/learning/flashcards.ts
git commit -m "feat: add review_snapshot and undone_at fields to flashcard attempts"
```

---

### Task 4: Servidor — avaliação binária + snapshot + filtro de undone

**Files:**
- Modify: `lib/learning/flashcards.ts` (`persistFlashcardAttempt`, `persistFlashcardAttemptUnlocked`, `completeFlashcardPracticeUnlocked`, `getActiveFlashcardPractice`)
- Test: `tests/unit/flashcard-persistence.test.ts`

**Interfaces:**
- Consome: `resolveBinaryRating`, `inferRecallRating` (Task 2); campos `review_snapshot`, `undone_at` (Task 3).
- Produz: `persistFlashcardAttempt` aceita `remembered?: unknown` no input. Quando `remembered` é boolean, o servidor decide a nota via `resolveBinaryRating` (ignora `input.rating`). Quando ausente, comportamento legado (`input.rating` válido ou inferência). Tentativas com `undone_at` são invisíveis para rebuild/completion/resume.

- [ ] **Step 1: Testes falhando** (adicionar em `tests/unit/flashcard-persistence.test.ts`, seguindo o padrão de mocks já existente no arquivo — `listRecords` por tabela, `createRecord`/`updateRecord`/`createEvent`):

```ts
it("resolves the rating server-side from the binary choice", async () => {
  listRecords.mockImplementation(async (table: string) => {
    if (table === "practiceSessions") return [session];
    if (table === "flashcards") return [cardRecord];
    if (table === "flashcardAttempts") return attempts;
    return [];
  });
  const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
  const wrongButClaimed = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "olla", remembered: true, forgot: false, responseTimeMs: 2400 });
  expect(wrongButClaimed.rating).toBe("hard");
  expect(wrongButClaimed.suggestedRating).toBe("forgot");
});

it("maps 'Não lembrei' to forgot regardless of the typed answer", async () => {
  const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
  const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-002", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: false, forgot: false, responseTimeMs: 1200 });
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
  await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-003", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: true, responseTimeMs: 2400 });
  const attemptUpdate = updateRecord.mock.calls.find(([table]) => table === "flashcardAttempts");
  const snapshot = JSON.parse((attemptUpdate![2] as { review_snapshot: string }).review_snapshot);
  expect(snapshot["word-a"]).toMatchObject({ familiarity_score: 4, review_ease: 2.5 });
});

it("ignores undone attempts when rebuilding the queue", async () => {
  attempts = [{ id: "attempt-0", fields: { practice_session_id: session.id, flashcard_id: cardRecord.id, word_id: "word-a", presentation_number: 1, client_attempt_id: "old-001", user_answer: "x", normalized_answer: "x", match_result: "incorrect", suggested_rating: "forgot", final_rating: "forgot", was_correct: false, response_time_ms: 1000, used_speech: false, audio_replay_count: 0, created_at: "2026-07-10T12:01:00.000Z", undone_at: "2026-07-10T12:02:00.000Z" } }];
  const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
  // Sem o filtro, a tentativa antiga contaria e presentationNumber 1 falharia com 409.
  const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "bin-004", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", remembered: true, responseTimeMs: 1500 });
  expect(result.presentationNumber).toBe(1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts`
Expected: os 4 testes novos FAIL.

- [ ] **Step 3: Implementar em `persistFlashcardAttemptUnlocked`**

a) Assinatura de `persistFlashcardAttempt` e `persistFlashcardAttemptUnlocked`: adicionar `remembered?: unknown` ao tipo do input (ambas).

b) Substituir as linhas 488-489 (`const suggestedRating = ...` / `const rating = ...`) por:

```ts
    const inferredRating = inferRecallRating({ match: matchResult, forgot, responseTimeMs, cardType: card.type });
    const rating = typeof input.remembered === "boolean"
      ? resolveBinaryRating({ remembered: input.remembered, match: matchResult, forgot, responseTimeMs, cardType: card.type })
      : isRecallRating(input.rating) ? input.rating : inferredRating;
```

c) Na criação do record (linha ~500): `suggested_rating: inferredRating`.

d) Snapshot — dentro do `if (reviewableWords.length && ...)`, ANTES do `try`, capturar:

```ts
      const reviewSnapshot = Object.fromEntries(reviewableWords.map((word) => [word.id, {
        familiarity_score: word.fields.familiarity_score ?? null,
        review_due_at: word.fields.review_due_at ?? null,
        review_interval_days: word.fields.review_interval_days ?? null,
        review_ease: word.fields.review_ease ?? null,
        review_streak: word.fields.review_streak ?? null,
        lapse_count: word.fields.lapse_count ?? null,
        learning_step: word.fields.learning_step ?? null,
        last_reviewed_at: word.fields.last_reviewed_at ?? null,
        last_rating: word.fields.last_rating ?? null,
        average_response_time_ms: word.fields.average_response_time_ms ?? null,
        review_state: word.fields.review_state ?? null,
        review_version: word.fields.review_version ?? null,
        leech_flagged_at: word.fields.leech_flagged_at ?? null
      }]));
```

e) No `updateRecord` que marca `review_applied` (linha ~524), incluir o snapshot:

```ts
        await client.updateRecord<FlashcardAttemptFields>("flashcardAttempts", record.id, { review_applied: true, resulting_review_state: resultingState, review_snapshot: JSON.stringify(reviewSnapshot) });
```

f) Filtros de undone — três pontos:
- `persistFlashcardAttemptUnlocked` linha ~472: `attemptRecords.filter((record) => record.fields.practice_session_id === sessionId && !record.fields.undone_at)`.
- `completeFlashcardPracticeUnlocked` linha ~568: mesmo filtro no `persistedAttempts`.
- `getActiveFlashcardPractice` linha ~375: mesmo filtro.

- [ ] **Step 4: Verificar + commit**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-completion.test.ts tests/unit/flashcard-api.test.ts && npm run typecheck && npm run lint`
Expected: PASS (os testes antigos de rating explícito continuam passando pelo caminho legado).

```bash
git add lib/learning/flashcards.ts tests/unit/flashcard-persistence.test.ts
git commit -m "feat: server-side binary rating with review snapshot and undone filtering"
```

---

### Task 5: Endpoint de preview exato (`/api/practice/flashcards/preview`)

**Files:**
- Modify: `lib/learning/spaced-repetition.ts` (adicionar `previewSingleInterval` exportada)
- Modify: `lib/learning/flashcards.ts` (adicionar `previewFlashcardAttemptIntervals`)
- Create: `app/api/practice/flashcards/preview/route.ts`
- Test: `tests/unit/flashcard-persistence.test.ts` (função) e `tests/unit/flashcard-api.test.ts` (rota)

**Interfaces:**
- Produz:
  - `previewSingleInterval(current: ReviewFields, attempt: ReviewAttempt, now?: Date, timeZone?: string, fuzzSeed?: string): number` — dias até o vencimento para UMA tentativa hipotética, sem persistir.
  - `previewFlashcardAttemptIntervals(input: { sessionId?: unknown; cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; forgot?: unknown; responseTimeMs?: unknown }): Promise<{ match: AnswerMatch; inferredRating: RecallRating; forgotDays: number; rememberedDays: number }>` — valida que o card é o item atual da fila (mesma checagem do persist) e calcula os dois intervalos exatos sobre a palavra-alvo.
  - Rota `POST /api/practice/flashcards/preview` → `{ ok: true, match, inferredRating, forgotDays, rememberedDays }`.

- [ ] **Step 1: Testes falhando**

Em `tests/unit/flashcard-persistence.test.ts` (mesmo setup de mocks; palavra nova sem campos de revisão):

```ts
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
```

Em `tests/unit/flashcard-api.test.ts`: adicionar `previewFlashcardAttemptIntervals` ao mock factory de `../../lib/learning/flashcards` e:

```ts
it("returns exact interval previews for the binary buttons", async () => {
  previewFlashcardAttemptIntervals.mockResolvedValue({ match: "exact", inferredRating: "easy", forgotDays: 1, rememberedDays: 15 });
  const { POST } = await import("../../app/api/practice/flashcards/preview/route");
  const body = { sessionId: "session-a", cardId: "card-a", presentationNumber: 1, userAnswer: "hola", responseTimeMs: 1200 };
  const response = await POST(new Request("http://localhost/api/practice/flashcards/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  expect(previewFlashcardAttemptIntervals).toHaveBeenCalledWith(body);
  expect(await response.json()).toMatchObject({ ok: true, forgotDays: 1, rememberedDays: 15 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts`
Expected: FAIL (função/rota inexistentes).

- [ ] **Step 3: Implementar `previewSingleInterval`**

Em `lib/learning/spaced-repetition.ts`, ao lado de `previewReviewIntervals`:

```ts
// Exact due-distance preview for one hypothetical attempt (rating + response time known).
export function previewSingleInterval(current: ReviewFields, attempt: ReviewAttempt, now = new Date(), timeZone = "UTC", fuzzSeed = ""): number {
  const review = calculateAdaptiveReview(current, [attempt], now, timeZone, fuzzSeed);
  return Math.max(1, Math.round((Date.parse(review.reviewDueAt) - now.getTime()) / DAY_MS));
}
```

- [ ] **Step 4: Implementar `previewFlashcardAttemptIntervals`**

Em `lib/learning/flashcards.ts`, após `persistFlashcardAttempt`. Reutilizar o mesmo carregamento/validação de `persistFlashcardAttemptUnlocked` (sessão ativa, cards, filtro de undone, `rebuildFlashcardQueue`, item atual confere):

```ts
export async function previewFlashcardAttemptIntervals(input: { sessionId?: unknown; cardId?: unknown; presentationNumber?: unknown; userAnswer?: unknown; forgot?: unknown; responseTimeMs?: unknown }) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  if (!sessionId) throw new LearningStateError("Informe a sessão de treino.", 422);
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const [sessions, cardRecords, attemptRecords, words] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000),
    client.listRecords<WordFields>("words", 500)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && item.fields.status === "active");
  if (!session) throw new LearningStateError("Sessão ativa de treino não encontrada.", 404);
  const cards = cardRecords.filter((record) => record.fields.practice_session_id === sessionId).sort((a, b) => a.fields.initial_position - b.fields.initial_position).map(flashcardRecordToCard);
  const priorAttempts = attemptRecords.filter((record) => record.fields.practice_session_id === sessionId && !record.fields.undone_at).sort(compareAttemptRecords).map(attemptRecordToAnswer);
  const current = rebuildFlashcardQueue(cards, priorAttempts).currentItem;
  const cardId = typeof input.cardId === "string" ? input.cardId : "";
  const presentationNumber = Number(input.presentationNumber);
  if (!current || current.cardId !== cardId || current.presentationNumber !== presentationNumber) {
    throw new LearningStateError("A tentativa não corresponde ao próximo item da fila.", 409);
  }
  const card = cards.find((candidate) => candidate.id === cardId)!;
  const forgot = input.forgot === true;
  const userAnswer = typeof input.userAnswer === "string" ? input.userAnswer.trim().slice(0, 300) : "";
  if (!forgot && !userAnswer) throw new LearningStateError("Informe uma resposta ou marque que não lembra.", 422);
  const match = forgot ? "incorrect" as const : compareAnswerForCard(card, userAnswer);
  const responseTimeMs = Math.max(0, Math.min(300_000, Math.round(Number(input.responseTimeMs) || 0)));
  const inferredRating = resolveBinaryRating({ remembered: true, match, forgot, responseTimeMs, cardType: card.type });
  const word = words.find((item) => item.id === card.targetWordId && matchesLearningScope(item.fields, { userId: user.id, profileId: profile.id }));
  if (!word) throw new LearningStateError("Palavra do card não encontrada.", 404);
  const now = new Date();
  const timeZone = user.fields.timezone ?? "UTC";
  return {
    match,
    inferredRating,
    forgotDays: previewSingleInterval(word.fields, { rating: "forgot", responseTimeMs, cardType: card.type }, now, timeZone, word.id),
    rememberedDays: previewSingleInterval(word.fields, { rating: inferredRating, responseTimeMs, cardType: card.type }, now, timeZone, word.id)
  };
}
```

Adicionar `previewSingleInterval` ao import de `./spaced-repetition` (linha 13).

- [ ] **Step 5: Criar a rota**

`app/api/practice/flashcards/preview/route.ts`:

```ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { previewFlashcardAttemptIntervals } from "@/lib/learning/flashcards";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return jsonOk({ ok: true, ...(await previewFlashcardAttemptIntervals(body)) });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 6: Verificar + commit**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/learning/spaced-repetition.ts lib/learning/flashcards.ts app/api/practice/flashcards/preview/route.ts tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts
git commit -m "feat: exact interval preview endpoint for binary flashcard rating"
```

---

### Task 6: Endpoint de undo (`/api/practice/flashcards/[sessionId]/undo`)

**Files:**
- Modify: `lib/learning/flashcards.ts` (adicionar `undoFlashcardAttempt`)
- Create: `app/api/practice/flashcards/[sessionId]/undo/route.ts`
- Test: `tests/unit/flashcard-persistence.test.ts` e `tests/unit/flashcard-api.test.ts`

**Interfaces:**
- Produz: `undoFlashcardAttempt(sessionId: string): Promise<{ cardId: string; presentationNumber: number }>` — desfaz a tentativa não-desfeita mais recente da sessão ativa: restaura o `review_snapshot` nas palavras, marca `undone_at`, zera `review_applied` e decrementa `presentation_count` da sessão. Rota `POST` retorna `{ ok: true, cardId, presentationNumber }`.

- [ ] **Step 1: Testes falhando** (em `tests/unit/flashcard-persistence.test.ts`; reutilizar o mock pattern — a palavra `word-a` precisa existir em `words`):

```ts
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
```

(Nota: `compareAttemptRecords` ordena por `created_at`/criação — verificar a ordenação real em `lib/learning/flashcards.ts:802` e ajustar os timestamps dos mocks para que "latest" seja inequívoco.)

Em `tests/unit/flashcard-api.test.ts`, adicionar `undoFlashcardAttempt` ao mock factory e:

```ts
it("undoes the latest attempt of a session", async () => {
  undoFlashcardAttempt.mockResolvedValue({ cardId: "card-a", presentationNumber: 3 });
  const { POST } = await import("../../app/api/practice/flashcards/[sessionId]/undo/route");
  const response = await POST(new Request("http://localhost/api/practice/flashcards/session-a/undo", { method: "POST" }), { params: Promise.resolve({ sessionId: "session-a" }) });
  expect(response.status).toBe(200);
  expect(undoFlashcardAttempt).toHaveBeenCalledWith("session-a");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `undoFlashcardAttempt`**

Em `lib/learning/flashcards.ts`, após `previewFlashcardAttemptIntervals`:

```ts
export async function undoFlashcardAttempt(sessionId: string) {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão de treino.", 422);
  const client = getTeableClient();
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const [sessions, attemptRecords, words] = await Promise.all([
    client.listRecords<PracticeSessionFields>("practiceSessions", 300),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000),
    client.listRecords<WordFields>("words", 500)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.user_id === user.id && item.fields.language_profile_id === profile.id && item.fields.type === "flashcards" && item.fields.status === "active");
  if (!session) throw new LearningStateError("Sessão ativa de treino não encontrada.", 404);
  const liveAttempts = attemptRecords.filter((record) => record.fields.practice_session_id === session.id && !record.fields.undone_at).sort(compareAttemptRecords);
  const last = liveAttempts.at(-1);
  if (!last) throw new LearningStateError("Não há avaliação para desfazer.", 409);
  const snapshot = parseJson(last.fields.review_snapshot ?? "") as Record<string, Record<string, unknown>>;
  for (const [wordId, fields] of Object.entries(snapshot)) {
    const word = words.find((item) => item.id === wordId && matchesLearningScope(item.fields, { userId: user.id, profileId: profile.id }));
    if (word) await client.updateRecord<WordFields>("words", wordId, fields);
  }
  const now = new Date().toISOString();
  await client.updateRecord<FlashcardAttemptFields>("flashcardAttempts", last.id, { undone_at: now, review_applied: false });
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, { presentation_count: liveAttempts.length - 1, updated_at: now });
  await client.createEvent(user.id, "flashcard_attempt_undone", { session_id: session.id, flashcard_id: last.fields.flashcard_id, presentation_number: last.fields.presentation_number });
  return { cardId: last.fields.flashcard_id, presentationNumber: last.fields.presentation_number };
}
```

- [ ] **Step 4: Criar a rota**

`app/api/practice/flashcards/[sessionId]/undo/route.ts` (espelhando `abandon/route.ts`):

```ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { undoFlashcardAttempt } from "@/lib/learning/flashcards";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return jsonOk({ ok: true, ...(await undoFlashcardAttempt(sessionId)) });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 5: Verificar + commit**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/learning/flashcards.ts app/api/practice/flashcards/[sessionId]/undo/route.ts tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts
git commit -m "feat: undo latest flashcard attempt with review snapshot restore"
```

---

### Task 7: UI — 2 botões, intervalo exato, microcopy e desfazer

**Files:**
- Modify: `components/FlashcardTrainer.tsx`
- Modify: `tests/e2e/qa-flow.spec.ts` (apenas se referenciar os 4 botões — verificar com grep)

**Interfaces:**
- Consome: `inferRecallRating`, `rebuildFlashcardQueue` (lib); rotas `/preview` (Task 5) e `/undo` (Task 6); `persistFlashcardAttempt` com `remembered` (Task 4).

- [ ] **Step 1: Estado e imports**

Em `components/FlashcardTrainer.tsx`:
- Import: trocar `suggestRecallRating` por `inferRecallRating` e adicionar `rebuildFlashcardQueue` ao import de `@/lib/learning/flashcard-queue`.
- Trocar o estado `revealed` (linha 36) por:

```ts
const [revealed, setRevealed] = useState<{ match: AnswerMatch; forgot: boolean; responseTimeMs: number; inferredRating: RecallRating; forgotDays: number | null; rememberedDays: number | null } | null>(null);
const [undoState, setUndoState] = useState<{ expiresAt: number } | null>(null);
```

- Adicionar no topo do componente (após os outros `useEffect`):

```ts
useEffect(() => {
  if (!undoState) return;
  const timeout = setTimeout(() => setUndoState(null), Math.max(0, undoState.expiresAt - Date.now()));
  return () => clearTimeout(timeout);
}, [undoState]);
```

- [ ] **Step 2: `submitAttempt` com preview**

Substituir a função `submitAttempt` (linhas 108-118) por:

```tsx
async function submitAttempt(event?: FormEvent, forgot = false) {
  event?.preventDefault();
  if (revealed || busy || (!forgot && !input.trim())) return;
  recognitionRef.current?.stop();
  const card = cards.find((candidate) => candidate.id === currentItem?.cardId);
  if (!card || !currentItem) return;
  const match = forgot ? "incorrect" as const : compareAnswerForCard(card, input);
  const responseTimeMs = Math.max(0, Date.now() - presentationStartedAt);
  setListening(false);
  const fallback = { inferredRating: inferRecallRating({ match, forgot, responseTimeMs, cardType: card.type }), forgotDays: null, rememberedDays: null };
  try {
    const response = await fetch("/api/practice/flashcards/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, cardId: currentItem.cardId, presentationNumber: currentItem.presentationNumber, userAnswer: input.trim(), forgot, responseTimeMs }) });
    const data = await response.json() as { ok?: boolean; inferredRating?: RecallRating; forgotDays?: number; rememberedDays?: number };
    if (!response.ok || !data.ok || typeof data.forgotDays !== "number" || typeof data.rememberedDays !== "number") throw new Error("preview unavailable");
    setRevealed({ match, forgot, responseTimeMs, inferredRating: data.inferredRating ?? fallback.inferredRating, forgotDays: data.forgotDays, rememberedDays: data.rememberedDays });
  } catch {
    setRevealed({ match, forgot, responseTimeMs, ...fallback });
  }
}
```

- [ ] **Step 3: `grade` binário + registro do undo**

Substituir `async function grade(rating: RecallRating)` por `async function grade(remembered: boolean)`; no body do fetch de attempt trocar `rating` por `remembered`; após `persisted` ser obtido com sucesso, adicionar `setUndoState({ expiresAt: Date.now() + 5_000 });`. O restante do fluxo (advance/complete) não muda. Atualizar os call sites para `void grade(false)` / `void grade(true)`. Garantir que `resetAttempt` também chama `setUndoState(null)`? NÃO — o undo precisa sobreviver ao avanço para o próximo card; o timeout de 5s cuida da expiração.

- [ ] **Step 4: `undoLast`**

```tsx
async function undoLast() {
  if (!undoState || busy) return;
  setBusy(true); setError("");
  try {
    const response = await fetch(`/api/practice/flashcards/${sessionId}/undo`, { method: "POST" });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível desfazer.");
    const remainingAnswers = answers.slice(0, -1);
    const rebuilt = rebuildFlashcardQueue(cards, remainingAnswers);
    setAnswers(remainingAnswers); setQueue(rebuilt.queue); setCurrentItem(rebuilt.currentItem); setUndoState(null); resetAttempt();
  } catch (undoError) { setError(undoError instanceof Error ? undoError.message : "Não foi possível desfazer."); }
  finally { setBusy(false); }
}
```

- [ ] **Step 5: JSX da revelação + barra de undo**

Substituir o bloco `<section className="flashcard-reveal">` (linhas 252-263) por:

```tsx
<section className="flashcard-reveal" aria-live="polite">
  <div><span>Resposta esperada</span><strong>{card.expectedAnswer}</strong></div>
  <div><span>Sua tentativa</span><strong>{revealed.forgot ? "Não lembrei" : input}</strong></div>
  <p className={`answer-match ${revealed.match}`}>{matchLabel(revealed.match)}</p>
  <p>{ratingExplanation(revealed)}</p>
  <div className="recall-rating-grid">
    <button disabled={busy} onClick={() => void grade(false)} type="button"><X /> Não lembrei{revealed.forgotDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.forgotDays)}</span> : null}</button>
    <button className="suggested" disabled={busy} onClick={() => void grade(true)} type="button"><Check /> Lembrei{revealed.rememberedDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.rememberedDays)}</span> : null}</button>
  </div>
</section>
```

Logo após o fechamento dessa section (ainda dentro da tela de sessão), adicionar:

```tsx
{undoState ? <p className="speech-status">Avaliação registrada. <button className="outline-button" disabled={busy} onClick={() => void undoLast()} type="button">Desfazer</button></p> : null}
```

Adicionar helper no fim do arquivo:

```tsx
function ratingExplanation(revealed: { forgot: boolean; match: AnswerMatch; inferredRating: RecallRating }) {
  if (revealed.forgot || revealed.match === "incorrect") return "Se você sabia e só errou na digitação, marque Lembrei — conta como Difícil.";
  if (revealed.inferredRating === "easy") return "Resposta rápida — conta como Fácil.";
  if (revealed.inferredRating === "hard") return "Quase lá — conta como Difícil.";
  return "Resposta correta.";
}
```

- [ ] **Step 6: Copy residual**

- `matchLabel` caso `unknown`: trocar para `"Variação não reconhecida — conta como Difícil"`.
- Card "Como funciona" (linha ~293): trocar o texto para `"Digite ou fale sua tentativa. A resposta só aparece depois, e o treino agenda a próxima revisão pelo seu acerto e tempo de resposta."`.
- Remover do import de ícones o que ficar sem uso (`Sparkles` continua usado no card "Como funciona"; verificar `Clock3`, `Layers3`, etc. com lint).

- [ ] **Step 7: Verificar e2e + commit**

Run: `grep -n "Não lembrei\|Difícil\|Fácil\|suggested" tests/e2e/qa-flow.spec.ts` — se houver seletores dos 4 botões, atualizar para os 2.
Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: PASS.

```bash
git add components/FlashcardTrainer.tsx tests/e2e/qa-flow.spec.ts
git commit -m "feat: binary flashcard rating UI with exact intervals and undo"
```

---

### Task 8: Remover `intervalPreviewDays` + atualizar docs + verificação final

**Files:**
- Modify: `lib/learning/flashcard-contracts.ts:32` (remover campo)
- Modify: `lib/learning/flashcards.ts:302-306,377-382` (remover computação) e import de `previewReviewIntervals`
- Modify: `lib/learning/spaced-repetition.ts:142-151` (remover `previewReviewIntervals`)
- Test: `tests/unit/spaced-repetition.test.ts` (reescrever testes de preview contra `previewSingleInterval`)
- Modify: `docs/FLASHCARD_CURRENT_FLOW.md` (e qualquer doc que descreva os 4 botões)

**Interfaces:**
- Consome: `previewSingleInterval` (Task 5) substitui `previewReviewIntervals`.

- [ ] **Step 1: Localizar todas as referências**

Run: `grep -rn "intervalPreviewDays\|previewReviewIntervals" --include="*.ts" --include="*.tsx" lib app components tests`
Expected: apenas os arquivos listados acima. Se aparecer outro, incluir no escopo.

- [ ] **Step 2: Reescrever testes de preview (TDD da remoção)**

Em `tests/unit/spaced-repetition.test.ts`, os testes de `previewReviewIntervals` viram testes de `previewSingleInterval` com as mesmas massas de dados, agora incluindo `responseTimeMs` no attempt. Exemplo:

```ts
it("previews the exact due distance for a single attempt", () => {
  const days = previewSingleInterval(newWordFields, { rating: "forgot", responseTimeMs: 1500, cardType: "target_to_native" }, new Date("2026-08-06T12:00:00.000Z"), "UTC", "word-a");
  expect(days).toBe(1);
});
```

(Usar as fixtures já existentes no arquivo; nomes exatos devem seguir o que já está lá.)

- [ ] **Step 3: Remover o código morto**

- `flashcard-contracts.ts`: remover `intervalPreviewDays?: ...` do tipo `Flashcard`.
- `flashcards.ts`: remover os dois blocos que computam `intervalPreviewDays` (criação e resume) e o import de `previewReviewIntervals`.
- `spaced-repetition.ts`: remover `previewReviewIntervals` (manter `previewSingleInterval`).

- [ ] **Step 4: Atualizar docs**

Run: `grep -rln "Difícil\|Fácil\|4 botões\|quatro botões" docs/*.md`
Em `docs/FLASHCARD_CURRENT_FLOW.md` (e demais encontrados): atualizar a seção de avaliação para o fluxo binário (2 botões, nota inferida por acerto + tempo, desfazer de 5s, intervalos exatos). Manter o restante do documento.

- [ ] **Step 5: Verificação final completa**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: tudo verde, sem referências residuais.

- [ ] **Step 6: Commit**

```bash
git add lib components tests docs
git commit -m "refactor: remove per-card interval previews replaced by exact preview endpoint"
```

---

## Self-Review (concluído pelo autor do plano)

- Cobertura da spec: Seção 1 (UX) → Task 7; Seção 2 (inferência, snapshot, undo, preview exato) → Tasks 2, 3, 4, 5, 6; Seção 3 (auditoria) → Task 1; doc update (risco listado na spec) → Task 8. ✅
- Placeholders: nenhum passo sem código/comando; os dois pontos marcados "verificar/ajustar" (ordenção de `compareAttemptRecords` na Task 6 e fixtures da Task 8) apontam o arquivo exato onde confirmar. ✅
- Consistência de tipos: `inferRecallRating`/`resolveBinaryRating` (Task 2) são os mesmos nomes consumidos nas Tasks 4, 5, 7; `previewSingleInterval` definido na Task 5 e consumido na 8; `undoFlashcardAttempt` definido na 6 e consumido na 7; campos `review_snapshot`/`undone_at` definidos na 3 e usados nas 4 e 6. ✅
