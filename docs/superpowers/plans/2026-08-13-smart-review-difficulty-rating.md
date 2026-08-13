# Revisão Inteligente — Rating por Dificuldade, Type-in e Geração de Frases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a autoavaliação binária "Não lembrei/Lembrei" por "Difícil/Fácil" com semântica correta no SRS, corrigir dois bugs do type-in (ditado por voz em cards de escuta e texto residual no "Não lembro"), tornar a geração de frases mais robusta (retry + telemetria de rejeições) e o flag `adapted` fiel a qualquer fallback de tipo.

**Architecture:** Mudança cirúrgica. O servidor ganha um novo resolvedor de rating (`resolveDifficultyRating`) acionado por um campo opcional `difficulty` no payload da tentativa; o caminho legado (`remembered`) continua funcionando para sessões iniciadas antes do deploy. O preview de intervalos passa a retornar `hardDays`/`easyDays`. A UI ganha dois modos na revelação: auto-forgot (sem escolha) e escolha de dificuldade. A geração de frases ganha 1 retry com backoff de 600ms e `validateGeneratedPhrases` passa a reportar motivos de rejeição.

**Tech Stack:** Next.js App Router, React client components, Vitest (unit), Playwright (e2e), Teable (persistência).

## Global Constraints

- Cópias exatas (pt-BR): botões **"Difícil"** e **"Fácil"**; botão de avanço no auto-forgot **"Continuar"**; mensagem de auto-forgot **"Sem problema — este card volta ainda nesta sessão."**; mensagem de treino adaptado **"Ajustamos algumas atividades do treino de hoje para manter o ritmo."**
- Backward compat obrigatória: `POST /api/practice/flashcards/attempt` continua aceitando o campo legado `remembered` (boolean) quando `difficulty` está ausente.
- Geração de frases: timeout de 8s por chamada, no máximo 1 retry com backoff de 600ms, fallback final silencioso para cards determinísticos.
- O flag `adapted` passa a ser `cards.some((card) => card.generationSource === "fallback")`.
- Não alterar a matemática do SRS (`lib/learning/spaced-repetition.ts`) nem a fila pedagógica (`advanceFlashcardQueue`).
- Comandos de verificação: unit `npx vitest run <arquivo>`, tipo `npm run typecheck`, lint `npm run lint`, e2e `npx playwright test tests/e2e/qa-flow.spec.ts`.
- Cada task termina em commit (`git add` dos arquivos da task + `git commit`).

---

### Task 1: `resolveDifficultyRating` no resolvedor de ratings

**Files:**
- Modify: `lib/learning/flashcard-contracts.ts`
- Modify: `lib/learning/flashcard-queue.ts`
- Test: `tests/unit/flashcard-queue.test.ts`

**Interfaces:**
- Consumes: `inferRecallRating` (já existe em `flashcard-queue.ts:7`), tipos `AnswerMatch`, `RecallRating`, `Flashcard`.
- Produces:
  - `flashcardDifficulties` (`["hard", "easy"] as const`) e `type FlashcardDifficulty` em `flashcard-contracts.ts` — usados pelas Tasks 2 e 3.
  - `resolveDifficultyRating(input: { difficulty: FlashcardDifficulty; match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating` em `flashcard-queue.ts` — usado pela Task 2.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/unit/flashcard-queue.test.ts`, adicionar `resolveDifficultyRating` ao import da linha 2 e um novo caso após o teste "resolves the binary choice into a 4-value rating" (`:15-23`):

```ts
  it("resolves the difficulty choice into a 4-value rating", () => {
    const base = { responseTimeMs: 1000, cardType: "native_to_target" } as const;
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "exact", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "minor_error", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "exact", forgot: false })).toBe("easy");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "exact", forgot: false, responseTimeMs: 9000 })).toBe("good");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "minor_error", forgot: false })).toBe("hard");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "incorrect", forgot: false })).toBe("forgot");
    expect(resolveDifficultyRating({ ...base, difficulty: "easy", match: "unknown", forgot: false })).toBe("forgot");
    expect(resolveDifficultyRating({ ...base, difficulty: "hard", match: "exact", forgot: true })).toBe("forgot");
  });
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `npx vitest run tests/unit/flashcard-queue.test.ts`
Expected: FAIL com "resolveDifficultyRating is not a function" (ou erro de tipo no import).

- [ ] **Step 3: Implementar**

Em `lib/learning/flashcard-contracts.ts`, após a linha 9 (`RecallRating`):

```ts
export const flashcardDifficulties = ["hard", "easy"] as const;
export type FlashcardDifficulty = (typeof flashcardDifficulties)[number];
```

Em `lib/learning/flashcard-queue.ts`, atualizar o import da linha 1 para incluir `FlashcardDifficulty` e adicionar após `resolveBinaryRating` (`:20`):

```ts
// Difficulty UI: after a correct-enough typed answer the user self-reports effort
// ("Difícil"/"Fácil"). A wrong/unknown/forgotten answer is always "forgot" — the
// self-report never overrides it, so there is no "I knew it" inflation path.
export function resolveDifficultyRating(input: { difficulty: FlashcardDifficulty; match: AnswerMatch; forgot: boolean; responseTimeMs: number; cardType: Flashcard["type"] }): RecallRating {
  if (input.forgot || input.match === "incorrect" || input.match === "unknown") return "forgot";
  if (input.difficulty === "hard") return "hard";
  return inferRecallRating(input);
}
```

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/flashcard-queue.test.ts`
Expected: PASS (todos os casos, incluindo os legados de `resolveBinaryRating` — que permanece intacto).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcard-contracts.ts lib/learning/flashcard-queue.ts tests/unit/flashcard-queue.test.ts
git commit -m "feat(flashcards): add resolveDifficultyRating for the Difícil/Fácil self-report"
```

---

### Task 2: Contrato do servidor — `difficulty` na tentativa e `hardDays`/`easyDays` no preview

**Files:**
- Modify: `lib/learning/flashcards.ts:435-656` (`persistFlashcardAttempt`, `persistFlashcardAttemptUnlocked`, `previewFlashcardAttemptIntervals`)
- Test: `tests/unit/flashcard-persistence.test.ts`
- Test: `tests/unit/flashcard-api.test.ts`

**Interfaces:**
- Consumes: `resolveDifficultyRating` e `FlashcardDifficulty` (Task 1).
- Produces:
  - `persistFlashcardAttempt(input)` aceita `input.difficulty?: unknown` (`"hard" | "easy"` válido via `isFlashcardDifficulty`).
  - `previewFlashcardAttemptIntervals(input)` retorna `{ match: AnswerMatch; forgotDays: number; hardDays: number; easyDays: number }` (sem `rememberedDays`, sem `inferredRating`) — a Task 3 consome exatamente estes campos.

- [ ] **Step 1: Atualizar/escrever os testes que falham**

Em `tests/unit/flashcard-persistence.test.ts`:

a) Manter os testes legados `:153-162` (caminho `remembered` continua válido) e adicionar, após o teste "maps 'Não lembrei' to forgot regardless of the typed answer" (`:158-162`), novos casos (o setup `session`/`cardRecord`/`attempts` e os mocks `listRecords` já existentes no describe são reutilizados — ver `:145-151` para o padrão de `listRecords.mockImplementation`):

```ts
  it("maps 'Difícil' to hard without a lapse for a correct answer", async () => {
    listRecords.mockImplementation(async (table: string) => {
      if (table === "practiceSessions") return [session];
      if (table === "flashcards") return [cardRecord];
      if (table === "flashcardAttempts") return attempts;
      return [];
    });
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "dif-0001", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", difficulty: "hard", forgot: false, responseTimeMs: 2400 });
    expect(result.rating).toBe("hard");
  });

  it("maps 'Fácil' to the latency-inferred rating for a correct answer", async () => {
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "dif-0002", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "hola", difficulty: "easy", forgot: false, responseTimeMs: 1200 });
    expect(result.rating).toBe("easy");
  });

  it("auto-resolves a wrong typed answer to forgot when no difficulty is sent", async () => {
    const { persistFlashcardAttempt } = await import("../../lib/learning/flashcards");
    const result = await persistFlashcardAttempt({ sessionId: session.id, clientAttemptId: "dif-0003", cardId: cardRecord.id, presentationNumber: 1, userAnswer: "olla", forgot: false, responseTimeMs: 2400 });
    expect(result.rating).toBe("forgot");
  });
```

b) No teste "previews exact intervals for both binary choices without persisting" (`:179-195`), renomear para "previews exact intervals for the difficulty buttons without persisting" e substituir as asserções `:189-194` por:

```ts
    expect(preview.match).toBe("exact");
    expect(preview.forgotDays).toBe(1);
    expect(preview.easyDays).toBeGreaterThan(preview.forgotDays);
    expect(typeof preview.hardDays).toBe("number");
    expect(createRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
```

c) No teste de preview por sense (`:449-459`): substituir `expect(preview.rememberedDays).toBeGreaterThanOrEqual(40);` por `expect(preview.easyDays).toBeGreaterThanOrEqual(40);`. No teste de fallback do sense (`:462-471`): substituir `expect(preview.rememberedDays).toBeLessThan(40);` por `expect(preview.easyDays).toBeLessThan(40);`.

Em `tests/unit/flashcard-api.test.ts`, no teste "returns exact interval previews for the binary buttons" (`:62-70`), renomear para "returns exact interval previews for the difficulty buttons" e trocar o mock/asserção:

```ts
    previewFlashcardAttemptIntervals.mockResolvedValue({ match: "exact", forgotDays: 1, hardDays: 4, easyDays: 15 });
```
```ts
    expect(await response.json()).toMatchObject({ ok: true, forgotDays: 1, hardDays: 4, easyDays: 15 });
```

- [ ] **Step 2: Rodar os testes e verificar que falham**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts`
Expected: FAIL — `preview.rememberedDays`/`easyDays` indefinidos e `difficulty` ignorado (ratings antigos).

- [ ] **Step 3: Implementar**

Em `lib/learning/flashcards.ts`:

a) Linha 12 — adicionar `resolveDifficultyRating` ao import de `./flashcard-queue`. Linha 24 — adicionar `type FlashcardDifficulty` ao import de `./flashcard-contracts`.

b) Assinaturas: em `persistFlashcardAttempt` (`:435`) e `persistFlashcardAttemptUnlocked` (`:453`), adicionar `difficulty?: unknown;` ao tipo de `input`.

c) Helper junto aos demais (`isRecallRating`, `:919`):

```ts
function isFlashcardDifficulty(value: unknown): value is FlashcardDifficulty { return value === "hard" || value === "easy"; }
```

d) Resolução do rating em `persistFlashcardAttemptUnlocked` — substituir `:490-492`:

```ts
  const rating = isFlashcardDifficulty(input.difficulty)
    ? resolveDifficultyRating({ difficulty: input.difficulty, match: matchResult, forgot, responseTimeMs, cardType: card.type })
    : typeof input.remembered === "boolean"
      ? resolveBinaryRating({ remembered: input.remembered, match: matchResult, forgot, responseTimeMs, cardType: card.type })
      : isRecallRating(input.rating) ? input.rating
      : forgot || matchResult === "incorrect" || matchResult === "unknown" ? "forgot" : inferredRating;
```

(A última linha é o caminho do novo cliente no auto-forgot: sem `difficulty`/`remembered`/`rating`, resposta errada/desconhecida/esquecida vira `forgot`.)

e) Preview (`:650-655`) — substituir o bloco `return { ... }` de `previewFlashcardAttemptIntervals` por:

```ts
  const easyRating = resolveDifficultyRating({ difficulty: "easy", match, forgot, responseTimeMs, cardType: card.type });
  return {
    match,
    forgotDays: previewSingleInterval(schedule.fields, { rating: "forgot", responseTimeMs, cardType: card.type }, now, timeZone, schedule.id),
    hardDays: previewSingleInterval(schedule.fields, { rating: "hard", responseTimeMs, cardType: card.type }, now, timeZone, schedule.id),
    easyDays: previewSingleInterval(schedule.fields, { rating: easyRating, responseTimeMs, cardType: card.type }, now, timeZone, schedule.id)
  };
```

e remover a linha `:637` (`const inferredRating = resolveBinaryRating(...)`) — `resolveBinaryRating` segue usado no caminho legado da tentativa.

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts tests/unit/flashcard-completion.test.ts`
Expected: PASS (completion incluído para garantir que o caminho de conclusão não regrediu).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcard-persistence.test.ts tests/unit/flashcard-api.test.ts
git commit -m "feat(flashcards): accept difficulty on attempts and preview hard/easy intervals"
```

---

### Task 3: UI do FlashcardTrainer — botões Difícil/Fácil, auto-forgot e fixes do type-in

**Files:**
- Modify: `components/FlashcardTrainer.tsx`

**Interfaces:**
- Consumes: preview retornando `{ match, forgotDays, hardDays, easyDays }` e attempt aceitando `difficulty` (Task 2).
- Produces: nada consumido por outras tasks; a Task 5 (e2e) exercita esta UI pelos seletores: botões `/^Difícil/`, `/^Fácil/`, `"Continuar"`, texto `"Sem problema — este card volta ainda nesta sessão."`, label de textbox `"Resposta esperada em ..."` (inalterado).

- [ ] **Step 1: Implementar as mudanças de estado e handlers**

a) Linha 3 — remover `X` do import de `lucide-react` (fica sem uso após a troca dos botões). Linha 7 — remover `inferRecallRating` do import de `flashcard-queue` (fica sem uso). Linha 8 — remover `RecallRating` do import de tipos (fica sem uso após o item b).

b) Linha 36 — novo shape do estado `revealed`:

```ts
  const [revealed, setRevealed] = useState<{ match: AnswerMatch; forgot: boolean; responseTimeMs: number; hardDays: number | null; easyDays: number | null } | null>(null);
```

c) Substituir `submitAttempt` (`:115-133`) — limpa o input no caminho "Não lembro" e consome o novo preview:

```ts
  async function submitAttempt(event?: FormEvent, forgot = false) {
    event?.preventDefault();
    if (revealed || busy || (!forgot && !input.trim())) return;
    recognitionRef.current?.stop();
    const card = cards.find((candidate) => candidate.id === currentItem?.cardId);
    if (!card || !currentItem) return;
    const typedAnswer = forgot ? "" : input.trim();
    if (forgot) setInput("");
    const match = forgot ? "incorrect" as const : compareAnswerForCard(card, typedAnswer);
    const responseTimeMs = Math.max(0, Date.now() - presentationStartedAt);
    setListening(false);
    try {
      const response = await fetch("/api/practice/flashcards/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, cardId: currentItem.cardId, presentationNumber: currentItem.presentationNumber, userAnswer: typedAnswer, forgot, responseTimeMs }) });
      const data = await response.json() as { ok?: boolean; hardDays?: number; easyDays?: number };
      if (!response.ok || !data.ok || typeof data.hardDays !== "number" || typeof data.easyDays !== "number") throw new Error("preview unavailable");
      setRevealed({ match, forgot, responseTimeMs, hardDays: data.hardDays, easyDays: data.easyDays });
    } catch {
      setRevealed({ match, forgot, responseTimeMs, hardDays: null, easyDays: null });
    }
  }
```

d) Substituir a assinatura e o corpo do fetch em `grade` (`:135-142`) — `grade(remembered: boolean)` vira `grade(difficulty: "hard" | "easy" | null)`; o restante da função (`:143-162`) permanece igual:

```ts
  async function grade(difficulty: "hard" | "easy" | null) {
    if (!revealed || busy || !currentItem) return;
    setBusy(true); setError("");
    const clientAttemptId = currentAttemptId || crypto.randomUUID();
    setCurrentAttemptId(clientAttemptId);
    let persisted: FlashcardAnswer;
    try {
      const attemptResponse = await fetch("/api/practice/flashcards/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientAttemptId, cardId: currentItem.cardId, presentationNumber: currentItem.presentationNumber, userAnswer: revealed.forgot ? "" : input.trim(), ...(difficulty ? { difficulty } : {}), forgot: revealed.forgot, usedSpeech, responseTimeMs: revealed.responseTimeMs, audioReplayCount, usedSlowAudio, audioFailed }) });
```

- [ ] **Step 2: Implementar a revelação em dois modos e as cópias**

a) Substituir a seção de revelação (`:284-293`) por:

```tsx
      </form> : <section className="flashcard-reveal" aria-live="polite">
        <div><span>Resposta esperada</span><strong>{card.expectedAnswer}</strong></div>
        <div><span>Sua tentativa</span><strong>{revealed.forgot ? "Não lembrei" : input}</strong></div>
        <p className={`answer-match ${revealed.match}`}>{matchLabel(revealed.match)}</p>
        {isAutoForgot(revealed) ? <>
          <p>Sem problema — este card volta ainda nesta sessão.</p>
          <div className="recall-rating-grid"><button className="suggested" disabled={busy} onClick={() => void grade(null)} type="button"><Check /> Continuar</button></div>
        </> : <div className="recall-rating-grid">
          <button disabled={busy} onClick={() => void grade("hard")} type="button">Difícil{revealed.hardDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.hardDays)}</span> : null}</button>
          <button className="suggested" disabled={busy} onClick={() => void grade("easy")} type="button"><Check /> Fácil{revealed.easyDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.easyDays)}</span> : null}</button>
        </div>}
      </section>}
```

b) Substituir `ratingExplanation` (`:346-351`) pelo helper:

```ts
function isAutoForgot(revealed: { forgot: boolean; match: AnswerMatch }) {
  return revealed.forgot || revealed.match === "incorrect" || revealed.match === "unknown";
}
```

c) `matchLabel` (`:338-344`) — trocar o caso `unknown` para: `if (match === "unknown") return "Variação não reconhecida — vamos repetir nesta sessão";`

d) Mensagem de treino adaptado (`:263`) — nova cópia:

```tsx
      {adapted ? <p className="flashcard-adapted">Ajustamos algumas atividades do treino de hoje para manter o ritmo.</p> : null}
```

e) "Como funciona" (`:324`) — alinhar a explicação à nova mecânica: trocar o texto interno do `<p className="row-meta">` para `Digite ou fale sua tentativa. A resposta só aparece depois; então você diz se foi difícil ou fácil, e o treino agenda a próxima revisão pelo seu acerto, ritmo e dificuldade.`

- [ ] **Step 3: Corrigir o idioma do ditado por voz**

Linha 224 — incluir `listening` no caso pt-BR (o label `:280` já diz que a resposta é em português):

```ts
    recognition.lang = currentCard?.type === "target_to_native" || currentCard?.type === "listening" ? "pt-BR" : languageCode;
```

- [ ] **Step 4: Verificar tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS sem erros (em particular, nenhum símbolo não utilizado remanescente: `X`, `inferRecallRating`, `RecallRating`, `ratingExplanation`).

- [ ] **Step 5: Commit**

```bash
git add components/FlashcardTrainer.tsx
git commit -m "feat(flashcards): replace Não lembrei/Lembrei with Difícil/Fácil difficulty self-report"
```

---

### Task 4: Geração de frases robusta, telemetria de rejeições e flag `adapted` preciso

**Files:**
- Modify: `lib/learning/flashcards.ts:824-871` (`buildDeck`, `validateGeneratedPhrases`, `generatePhrases`) e `:321` (evento `flashcard_generation_completed`)
- Test: `tests/unit/flashcards.test.ts`, `tests/unit/flashcard-generation-fallback.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - `validateGeneratedPhrases(items, words)` retorna `{ phrases: Map<string, GeneratedPhrase>; rejectionReasons: Record<string, number> }` (mudança de assinatura — atualizar o uso em `flashcards.test.ts:123-131`).
  - `buildDeck(...)` retorna `{ cards, planned, adapted, rejectionReasons, fallbacksByType }` — `createFlashcardPractice` usa os dois últimos no evento `flashcard_generation_completed`.

- [ ] **Step 1: Atualizar/escrever os testes que falham**

a) Em `tests/unit/flashcards.test.ts`, teste "keeps valid phrases and discards invalid items independently" (`:121-131`) — adaptar ao novo retorno e asserir motivos:

```ts
    const { phrases, rejectionReasons } = validateGeneratedPhrases([
      { text: "Ayer fui al mercado.", translation: "Ontem fui ao mercado.", word_ids: ["word-a", "word-b"] },
      { text: "fui fui ayer", translation: "repetida", word_ids: ["word-a"] },
      { text: "```json fui```", translation: "técnica", word_ids: ["word-a"] },
      { text: "Texto sem alvo", translation: "inválida", word_ids: ["word-b"] }
    ], words);
    expect([...phrases.keys()]).toEqual(["word-a"]);
    expect(phrases.get("word-a")?.supportingWordIds).toEqual(["word-b"]);
    expect(rejectionReasons).toEqual({ target_occurrences: 1, technical_tokens: 1, unknown_words: 1 });
```

(Verificação dos motivos com a nova implementação: "fui fui ayer" tem o alvo 2x → `target_occurrences`; "```json fui```" → `technical_tokens`; "Texto sem alvo" tem 3 lexemas fora do vocabulário e da lista de function words → `unknown_words`.)

b) Ainda em `flashcards.test.ts`, no describe "buildDeck with mixed types" (`:160-183`), adicionar:

```ts
  it("marks the deck as adapted when a non-cloze type falls back", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-3", ["native_to_target"]);
    expect(deck.cards[0].type).toBe("target_to_native");
    expect(deck.cards[0].generationSource).toBe("fallback");
    expect(deck.adapted).toBe(true);
    expect(deck.fallbacksByType).toEqual({ target_to_native: 1 });
  }, 15_000);
```

(A geração de frases já está mockada para falhar neste arquivo — ver o comentário em `:17` — então não há frase para o fallback virar cloze.)

c) Em `tests/unit/flashcard-generation-fallback.test.ts`, adicionar dois casos de retry. O mock atual (`:3`) é fixo; parametrizar para controlar falhas por chamada — substituir as linhas 1-3 por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createChatCompletion = vi.fn();
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

beforeEach(() => createChatCompletion.mockReset());
```

(`mockReset` no `beforeEach` é obrigatório: sem ele, as contagens de `toHaveBeenCalledTimes` acumulam entre os testes.)

e adicionar ao describe:

```ts
  it("retries the phrase generation once and recovers cloze cards", async () => {
    createChatCompletion
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ content: JSON.stringify({ phrases: [{ text: "yo fui ayer", translation: "eu fui ontem", word_ids: ["word-0"] }] }) });
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = [{ id: "word-0", fields: { display_text: "fui", lemma: "fui", translation: "fui" } }] as never;
    const deck = await buildDeck(words, "Espanhol", "B1", "retry-seed", ["cloze"]);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(deck.cards[0].type).toBe("cloze");
  }, 15_000);

  it("gives up after one retry and keeps the deterministic fallback", async () => {
    createChatCompletion.mockRejectedValue(new Error("AI unavailable"));
    const { buildDeck } = await import("../../lib/learning/flashcards");
    const words = [{ id: "word-0", fields: { display_text: "fui", lemma: "fui", translation: "fui" } }] as never;
    const deck = await buildDeck(words, "Espanhol", "B1", "retry-seed", ["cloze"]);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(deck.cards[0].type).not.toBe("cloze");
    expect(deck.adapted).toBe(true);
  }, 15_000);
```

e ajustar o teste existente (`:6-16`) para começar com `createChatCompletion.mockRejectedValue(new Error("AI unavailable"));`.

- [ ] **Step 2: Rodar os testes e verificar que falham**

Run: `npx vitest run tests/unit/flashcards.test.ts tests/unit/flashcard-generation-fallback.test.ts`
Expected: FAIL — `validateGeneratedPhrases` retorna `Map` (sem `.phrases`/`.rejectionReasons`), `deck.fallbacksByType` inexistente, retry inexistente (1 chamada só).

- [ ] **Step 3: Implementar**

Em `lib/learning/flashcards.ts`:

a) `validateGeneratedPhrases` (`:835-856`) — novo retorno com motivos, desmembrando as condições combinadas:

```ts
export function validateGeneratedPhrases(items: GeneratedPhraseInput[], words: TeableRecord<WordFields>[]) {
  const generatedByWord = new Map<string, GeneratedPhrase>();
  const rejectionReasons: Record<string, number> = {};
  const reject = (reason: string) => { rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1; };
  const knownIds = new Set(words.map((word) => word.id));
  const vocabularyTokens = new Set(words.flatMap((word) => [word.fields.display_text, word.fields.lemma].filter(Boolean).flatMap((value) => lexicalTokens(value))));
  const seenSentences = new Set<string>();
  for (const item of items) {
    if (typeof item.text !== "string" || typeof item.translation !== "string" || !item.translation.trim()) { reject("invalid_shape"); continue; }
    const text = item.text.trim();
    if (countLexicalWords(text) > 5) { reject("too_many_words"); continue; }
    if (/```|https?:\/\/|\b(?:json|id|translation|word_ids)\b/iu.test(text)) { reject("technical_tokens"); continue; }
    const unknownLexicalWords = lexicalTokens(text).filter((token) => !vocabularyTokens.has(token) && !allowedFunctionWords.has(token));
    if (new Set(unknownLexicalWords).size > 1) { reject("unknown_words"); continue; }
    const normalizedSentence = text.toLocaleLowerCase();
    if (seenSentences.has(normalizedSentence)) { reject("duplicate"); continue; }
    const ids = Array.isArray(item.word_ids) ? item.word_ids.filter((id): id is string => typeof id === "string" && knownIds.has(id)) : [];
    if (!ids.length || ids.length > 2) { reject("bad_word_ids"); continue; }
    const target = words.find((candidate) => candidate.id === ids[0]);
    if (!target || targetOccurrenceCount(text, targetText(target)) !== 1) { reject("target_occurrences"); continue; }
    if (generatedByWord.has(target.id)) { reject("already_has_phrase"); continue; }
    generatedByWord.set(target.id, { text, translation: item.translation.trim(), supportingWordIds: ids.filter((id) => id !== target.id) });
    seenSentences.add(normalizedSentence);
  }
  return { phrases: generatedByWord, rejectionReasons };
}
```

b) `generatePhrases` (`:858-871`) — retry único com backoff de 600ms e prompt reforçado:

```ts
async function generatePhrases(words: TeableRecord<WordFields>[], language: string, level: string): Promise<{ phrases: Map<string, GeneratedPhrase>; rejectionReasons: Record<string, number> }> {
  if (!words.length) return { phrases: new Map(), rejectionReasons: {} };
  const vocabulary = words.map((word) => ({ id: word.id, word: word.fields.display_text || word.fields.lemma, translation: word.fields.translation }));
  const request = () => withTimeout(createChatCompletion([
    { role: "system", content: "Crie flashcards de frases naturais no idioma alvo e adequadas ao nível informado. Cada frase deve ter no máximo 5 palavras, usar a palavra-alvo exatamente como fornecida, uma única vez, sem flexionar ou conjugar, e resposta não ambígua. Use somente palavras muito comuns do idioma; permita no máximo uma palavra lexical nova e use artigos, preposições, pronomes ou auxiliares extras quando indispensável. Em word_ids, coloque primeiro o ID da palavra-alvo e opcionalmente um único ID de apoio. Responda somente JSON válido no formato {\"phrases\":[{\"text\":\"...\",\"translation\":\"...\",\"word_ids\":[\"target-id\",\"optional-support-id\"]}]} e escreva translation em português brasileiro." },
    { role: "user", content: `Idioma: ${language}\nNível: ${level}\nCrie ${words.length} frases. Cada frase deve usar uma palavra principal diferente desta lista: ${JSON.stringify(vocabulary)}\nVocabulário disponível: ${JSON.stringify(vocabulary)}` }
  ], { temperature: 0.45, maxTokens: 1200 }), 8_000);
  let rejectionReasons: Record<string, number> = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await request();
      const match = ai.content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? "{}") as { phrases?: GeneratedPhraseInput[] };
      const validated = validateGeneratedPhrases(parsed.phrases ?? [], words);
      rejectionReasons = validated.rejectionReasons;
      if (validated.phrases.size > 0) return validated;
    } catch { /* timeout/JSON inválido: tenta uma vez mais e depois cai no fallback determinístico */ }
  }
  return { phrases: new Map(), rejectionReasons };
}
```

c) `buildDeck` (`:824-830`) — flag `adapted` por qualquer fallback e contagem por tipo:

```ts
export async function buildDeck(words: TeableRecord<WordFields>[], language: string, level: string, seed: string, desiredTypes: FlashcardType[], sensesByWord?: Map<string, TeableRecord<WordSenseFields>[]>) {
  const planned = countPlannedTypes(desiredTypes);
  const generation = await generatePhrases(words, language, level);
  const resolved = resolveDueSenses(words, sensesByWord ?? new Map());
  const cards = resolved.map(({ word, sense }, index) => buildActiveRecallCard(word, sense, desiredTypes[index] ?? "target_to_native", generation.phrases.get(word.id), index, sensesByWord?.get(word.id) ?? []));
  const fallbacksByType: Record<string, number> = {};
  for (const card of cards) {
    if (card.generationSource === "fallback") fallbacksByType[card.type] = (fallbacksByType[card.type] ?? 0) + 1;
  }
  return { cards: seededShuffle(cards, seed), planned, adapted: cards.some((card) => card.generationSource === "fallback"), rejectionReasons: generation.rejectionReasons, fallbacksByType };
}
```

d) Telemetria em `createFlashcardPractice` (`:321`) — enriquecer o evento:

```ts
    await client.createEvent(user.id, "flashcard_generation_completed", { session_id: session.id, card_count: cards.length, duration_ms: Date.now() - operationStartedAt, fallback_used: deck.adapted, rejection_reasons: deck.rejectionReasons, fallbacks_by_type: deck.fallbacksByType });
```

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/flashcards.test.ts tests/unit/flashcard-generation-fallback.test.ts tests/unit/flashcard-observability.test.ts`
Expected: PASS (observability incluído: agrega payloads de `flashcard_generation_completed` e não deve regredir).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcards.test.ts tests/unit/flashcard-generation-fallback.test.ts
git commit -m "feat(flashcards): retry phrase generation and track rejection reasons and fallbacks"
```

---

### Task 5: Cobertura e2e — botões renomeados, auto-forgot e ditado em pt-BR na escuta

**Files:**
- Modify: `tests/e2e/qa-flow.spec.ts:52-121` (`mobile flashcard training completes a frozen deck once`), `:123-174` (sense), `:215-247` (listening), e novos testes ao final do arquivo

**Interfaces:**
- Consumes: UI da Task 3 (seletores `/^Difícil/`, `/^Fácil/`, `"Continuar"`) e contrato da Task 2 (`hardDays`/`easyDays` no preview, `difficulty` no attempt).
- Produces: nada.

- [ ] **Step 1: Atualizar os mocks e fluxos existentes**

a) Teste "mobile flashcard training completes a frozen deck once":
- Preview mock (`:74-77`): trocar o corpo para `{ ok: true, match: body.forgot ? "incorrect" : "exact", forgotDays: 1, hardDays: 3, easyDays: 7 }`.
- Attempt mock (`:78-81`): trocar a expressão de `rating` para `body.forgot ? "forgot" : body.difficulty === "hard" ? "hard" : "good"`.
- Asserções de intervalo (`:99-100`): `→ 7 dias` permanece (botão Fácil); trocar `→ 1 dia` por `→ 3 dias` (botão Difícil).
- `:101`: `getByRole("button", { name: /^Lembrei/ })` → `{ name: /^Fácil/ }`.
- `:106`: após "Não lembro" o fluxo é auto-forgot — `getByRole("button", { name: /^Não lembrei/ })` → `{ name: "Continuar" }`.
- `:110`: `getByRole("button", { name: /^Lembrei/ })` → `{ name: /^Fácil/ }`.
- Asserções finais (`:119-120`) permanecem: `answers[1]` casa `{ presentationNumber: 1, userAnswer: "", matchResult: "incorrect", rating: "forgot", forgot: true }` e `answers[2]` casa `{ presentationNumber: 2, rating: "good" }`.

b) Teste "sense-targeted flashcard presents the exercised meaning and completes":
- Preview mock (`:144-146`): `{ ok: true, match: "exact", forgotDays: 1, hardDays: 3, easyDays: 7 }`.
- `:169`: `/^Lembrei/` → `/^Fácil/`.

c) Teste "listening card plays audio prompt and shows interval hints":
- Preview mock (`:235-237`): `{ ok: true, match: "exact", forgotDays: 1, hardDays: 3, easyDays: 7 }`.
- Asserção `→ 7 dias` (`:246`) permanece válida (Fácil com `easyDays: 7`).

- [ ] **Step 2: Adicionar o cenário de resposta errada sem escolha**

Ao final de `tests/e2e/qa-flow.spec.ts`, adicionar:

```ts
test("wrong typed answer requeues the card without a difficulty choice", async ({ page }) => {
  const attemptBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/practice/flashcards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, activeSession: null }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, sessionId: "wrong-session", languageCode: "es", languageName: "Espanhol", cards: [
      { id: "wrong-card", sessionId: "wrong-session", type: "native_to_target", targetWordId: "word-a", supportingWordIds: [], prompt: "olá", expectedAnswer: "hola", acceptedAnswers: [], translation: "olá", difficulty: 2 }
    ] }) });
  });
  await page.route("**/api/practice/flashcards/preview", async (route) => {
    const body = route.request().postDataJSON() as { userAnswer?: string };
    const correct = body.userAnswer === "hola";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, match: correct ? "exact" : "incorrect", forgotDays: 1, hardDays: 3, easyDays: 7 }) });
  });
  await page.route("**/api/practice/flashcards/attempt", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    attemptBodies.push(body);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, attempt: { ...body, matchResult: body.userAnswer === "hola" ? "exact" : "incorrect", rating: body.userAnswer === "hola" ? "good" : "forgot" } }) });
  });
  await page.route("**/api/practice/flashcards/complete", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, score: 100, correctCards: 1, wrongCards: 0, totalCards: 1, reviewedWords: 1, uniqueCardCount: 1, presentationCount: 2, firstAttemptCorrect: 0, recoveredCards: 1, productionAccuracy: 100, listeningAccuracy: null }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  const answer = page.getByRole("textbox", { name: "Resposta esperada em Espanhol" });
  await answer.fill("olla");
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("Resposta diferente da esperada")).toBeVisible();
  await expect(page.getByText("Sem problema — este card volta ainda nesta sessão.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Difícil/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Fácil/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();

  // O card reapresenta (rating forgot reagenda); agora a resposta correta libera Difícil/Fácil.
  await answer.fill("hola");
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("Resposta exata")).toBeVisible();
  await page.getByRole("button", { name: /^Fácil/ }).click();
  await expect(page.getByRole("heading", { name: "100% de acerto" })).toBeVisible();

  expect(attemptBodies[0]).not.toHaveProperty("difficulty");
  expect(attemptBodies[0]).toMatchObject({ presentationNumber: 1, userAnswer: "olla", forgot: false });
  expect(attemptBodies[1]).toMatchObject({ presentationNumber: 2, userAnswer: "hola", difficulty: "easy" });
});
```

- [ ] **Step 3: Adicionar o cenário de ditado em pt-BR no card de escuta**

Ao final do arquivo, adicionar (reutiliza o padrão `MockRecognition` do teste de speech em `:249-265`):

```ts
test("listening card dictates the answer in Portuguese", async ({ page }) => {
  await page.addInitScript(() => {
    class MockRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { (window as unknown as { __flashcardRecognition: MockRecognition }).__flashcardRecognition = this; }
      start() {}
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: MockRecognition });
  });
  await page.route("**/api/voice/synthesize", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" }) });
  });
  await page.route("**/api/practice/flashcards", async (route) => route.fulfill({
    status: route.request().method() === "GET" ? 200 : 201,
    contentType: "application/json",
    body: JSON.stringify(route.request().method() === "GET" ? { ok: true, activeSession: null } : { ok: true, sessionId: "listening-speech", languageCode: "es", languageName: "Espanhol", cards: [
      { id: "listening-card", sessionId: "listening-speech", type: "listening", targetWordId: "word-a", supportingWordIds: [], prompt: "", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", audioText: "hola", difficulty: 3 }
    ] })
  }));

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await page.getByRole("button", { name: "Falar resposta" }).click();
  await page.evaluate(() => {
    const recognition = (window as unknown as { __flashcardRecognition: { lang: string; onresult: ((event: unknown) => void) | null } }).__flashcardRecognition;
    if (recognition.lang !== "pt-BR") throw new Error(`Unexpected recognition language: ${recognition.lang}`);
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "olá" } }] });
  });
  await expect(page.getByRole("textbox", { name: "Resposta esperada em português" })).toHaveValue("olá");
});
```

- [ ] **Step 4: Rodar a suite e2e**

Run: `npx playwright test tests/e2e/qa-flow.spec.ts`
Expected: PASS em todos os cenários do arquivo (os demais testes do arquivo não foram alterados e devem seguir verdes).

- [ ] **Step 5: Verificação final completa**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/qa-flow.spec.ts
git commit -m "test(flashcards): cover Difícil/Fácil flow, auto-forgot and pt-BR dictation on listening cards"
```

---

## Self-review notes (já aplicados)

- Cobertura da spec: remap semântico → Tasks 1-3; fixes do type-in → Task 3; robustez da geração + telemetria → Task 4; flag `adapted` + nova cópia → Tasks 4 e 3; testes unit/e2e → Tasks 1, 2, 4, 5.
- `resolveBinaryRating` e o campo `remembered` permanecem para backward compat (spec: abordagem cirúrgica).
- `previewFlashcardAttemptIntervals` deixa de retornar `rememberedDays`/`inferredRating`: o cliente antigo (sessão retomada após deploy) cai no fallback local sem dicas de intervalo — degradação graciosa aceita na spec.
- O retry de geração adiciona ~600ms reais por chamada falha nos testes unitários que forçam falha de IA — compatível com os timeouts de 15s já usados nesses arquivos.
