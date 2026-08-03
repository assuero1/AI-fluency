# PR C — Mix de Tipos de Card (produção, cloze, escuta) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reativar os tipos `native_to_target` (produção), `cloze` e `listening` na Revisão Inteligente, com escolha de tipo por estágio da palavra, flags granulares de rollout, micro-feedback de intervalo nos botões de avaliação e métricas por competência reais na tela de resultado.

**Architecture:** Seleção de tipo pura e determinística em `lib/learning/flashcard-type-selection.ts` (pesos por `review_state`, redistribuição quando áudio/flags desligados). `buildDeck` passa a receber os tipos desejados por posição; `buildActiveRecallCard` (já existente) monta o conteúdo e degrada com fallbacks. Preview de intervalo computado por `previewReviewIntervals` em `spaced-repetition.ts`, embutido no payload do card (não persistido — recomputado no resume, sem mudança de schema).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Vitest, Playwright, Teable.

**Spec:** `docs/superpowers/specs/2026-08-02-smart-review-redesign-design.md` (seções 4, 6, 8, 10.3).

## Global Constraints

- Escolha do tipo por estágio (`review_state` da palavra):
  - **Novas** (`new`/`learning`): 70% compreensão (`target_to_native`), 30% `cloze`.
  - **Em revisão** (`review`, `suspended`): 40% produção (`native_to_target`), 25% compreensão, 20% `cloze`, 15% `listening`.
  - **Difíceis** (`difficult`): variedade máxima — 25% cada tipo.
- `listening` só quando `audio_enabled` do perfil; caso contrário seus 15% redistribuem metade para produção e metade para compreensão.
- Flags granulares de rollout (default habilitado): `FLASHCARD_PRODUCTION_ENABLED`, `FLASHCARD_CLOZE_ENABLED`, `FLASHCARD_LISTENING_ENABLED` — valor `"false"` (case-insensitive) desliga; peso do tipo desligado vai para `target_to_native`. Kill switch `FLASHCARD_ACTIVE_RECALL_ENABLED` mantido.
- Seleção determinística por palavra: `hashSeed(`${seed}:${wordId}`)`, mesma seed do deck → mesma atribuição.
- Fallbacks de conteúdo já existentes em `buildActiveRecallCard` são mantidos: `native_to_target` sem tradução → `cloze`/`target_to_native`; `cloze` sem frase → `native_to_target`/`target_to_native`.
- Preview de intervalo NÃO é persistido (sem mudança de schema); recomputado na criação e no resume. Formato de exibição: `→ N dias` (singular `→ 1 dia`).
- Todos os tipos mantêm: tentativa obrigatória antes de revelar, rating sugerido automático, override nos 4 botões, gaps de reapresentação atuais (3/5, máx. 3 apresentações).
- Correção determinística existente mantida (aceitas = lemma/display variantes; diacríticos/artigo = `minor_error`). Nenhum trabalho novo de NLP neste PR.
- Sem mudança de schema Teable; nenhuma migração neste PR. Respostas de UI em português. Merge local sem push (push só com autorização).

---

### Task 1: Seleção de tipo por estágio (`lib/learning/flashcard-type-selection.ts`)

**Files:**
- Create: `lib/learning/flashcard-type-selection.ts`
- Test: `tests/unit/flashcard-type-selection.test.ts`

**Interfaces:**
- Consumes: `hashSeed` de `./spaced-repetition` (exportado no PR B); tipo `FlashcardType` de `./flashcard-contracts`.
- Produces (usados pela Task 2):
  - `type CardTypeFlags = { production: boolean; cloze: boolean; listening: boolean }`
  - `cardTypeWeights(reviewState: string | undefined, options: { audioEnabled: boolean; flags: CardTypeFlags }): Record<FlashcardType, number>`
  - `chooseCardTypes<T extends { id: string; fields: { review_state?: string } }>(words: T[], options: { seed: string; audioEnabled: boolean; flags: CardTypeFlags }): FlashcardType[]` (um tipo por posição, na ordem das palavras)
  - `countPlannedTypes(types: FlashcardType[]): { targetToNative: number; nativeToTarget: number; cloze: number; listening: number }`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/unit/flashcard-type-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cardTypeWeights, chooseCardTypes, countPlannedTypes } from "../../lib/learning/flashcard-type-selection";

const FLAGS_ON = { production: true, cloze: true, listening: true };

function word(id: string, reviewState?: string) {
  return { id, fields: { review_state: reviewState } };
}

describe("cardTypeWeights", () => {
  it("gives new/learning words 70% comprehension and 30% cloze", () => {
    for (const state of ["new", "learning", undefined]) {
      expect(cardTypeWeights(state, { audioEnabled: true, flags: FLAGS_ON })).toEqual({
        target_to_native: 0.7,
        native_to_target: 0,
        cloze: 0.3,
        listening: 0
      });
    }
  });

  it("gives review words the full mix", () => {
    expect(cardTypeWeights("review", { audioEnabled: true, flags: FLAGS_ON })).toEqual({
      native_to_target: 0.4,
      target_to_native: 0.25,
      cloze: 0.2,
      listening: 0.15
    });
  });

  it("gives difficult words maximum variety", () => {
    expect(cardTypeWeights("difficult", { audioEnabled: true, flags: FLAGS_ON })).toEqual({
      target_to_native: 0.25,
      native_to_target: 0.25,
      cloze: 0.25,
      listening: 0.25
    });
  });

  it("redistributes listening weight when audio is disabled", () => {
    expect(cardTypeWeights("review", { audioEnabled: false, flags: FLAGS_ON })).toEqual({
      native_to_target: 0.475,
      target_to_native: 0.325,
      cloze: 0.2,
      listening: 0
    });
    expect(cardTypeWeights("difficult", { audioEnabled: false, flags: FLAGS_ON }).listening).toBe(0);
  });

  it("routes a disabled type's weight to comprehension", () => {
    const weights = cardTypeWeights("review", { audioEnabled: true, flags: { production: false, cloze: true, listening: true } });
    expect(weights.native_to_target).toBe(0);
    expect(weights.target_to_native).toBeCloseTo(0.65, 10);
    const noCloze = cardTypeWeights("new", { audioEnabled: true, flags: { production: true, cloze: false, listening: true } });
    expect(noCloze.cloze).toBe(0);
    expect(noCloze.target_to_native).toBe(1);
  });
});

describe("chooseCardTypes", () => {
  it("is deterministic per word and seed", () => {
    const words = [word("a", "review"), word("b", "review"), word("c", "new")];
    const options = { seed: "deck-1", audioEnabled: true, flags: FLAGS_ON };
    const first = chooseCardTypes(words, options);
    expect(chooseCardTypes(words, options)).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("never picks listening when audio is disabled", () => {
    const words = Array.from({ length: 40 }, (_, index) => word(`w${index}`, "difficult"));
    const types = chooseCardTypes(words, { seed: "s", audioEnabled: false, flags: FLAGS_ON });
    expect(types).not.toContain("listening");
  });

  it("never picks a flag-disabled type", () => {
    const words = Array.from({ length: 40 }, (_, index) => word(`w${index}`, "review"));
    const types = chooseCardTypes(words, { seed: "s", audioEnabled: true, flags: { production: true, cloze: false, listening: false } });
    expect(types).not.toContain("cloze");
    expect(types).not.toContain("listening");
  });

  it("spreads types across a large difficult deck (sanity, not exact ratio)", () => {
    const words = Array.from({ length: 80 }, (_, index) => word(`w${index}`, "difficult"));
    const types = chooseCardTypes(words, { seed: "spread", audioEnabled: true, flags: FLAGS_ON });
    const counts = countPlannedTypes(types);
    expect(counts.nativeToTarget).toBeGreaterThan(5);
    expect(counts.cloze).toBeGreaterThan(5);
    expect(counts.listening).toBeGreaterThan(5);
    expect(counts.targetToNative).toBeGreaterThan(5);
  });
});

describe("countPlannedTypes", () => {
  it("counts each type", () => {
    expect(countPlannedTypes(["target_to_native", "cloze", "cloze", "listening", "native_to_target"])).toEqual({
      targetToNative: 1,
      nativeToTarget: 1,
      cloze: 2,
      listening: 1
    });
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/flashcard-type-selection.test.ts`
Expected: FAIL — `Cannot find module '../../lib/learning/flashcard-type-selection'`

- [ ] **Step 3: Implementar lib/learning/flashcard-type-selection.ts**

```ts
import type { FlashcardType } from "./flashcard-contracts";
import { hashSeed } from "./spaced-repetition";

export type CardTypeFlags = { production: boolean; cloze: boolean; listening: boolean };

const ALL_TYPES: FlashcardType[] = ["target_to_native", "native_to_target", "cloze", "listening"];

// Type weights per learning stage (spec section 4). Listening requires audio;
// a flag-disabled type's weight goes to comprehension (target_to_native).
export function cardTypeWeights(
  reviewState: string | undefined,
  options: { audioEnabled: boolean; flags: CardTypeFlags }
): Record<FlashcardType, number> {
  const base: Record<FlashcardType, number> = reviewState === "difficult"
    ? { target_to_native: 0.25, native_to_target: 0.25, cloze: 0.25, listening: 0.25 }
    : reviewState === "review" || reviewState === "suspended"
      ? { target_to_native: 0.25, native_to_target: 0.4, cloze: 0.2, listening: 0.15 }
      : { target_to_native: 0.7, native_to_target: 0, cloze: 0.3, listening: 0 };
  if (!options.audioEnabled) {
    base.native_to_target += base.listening / 2;
    base.target_to_native += base.listening / 2;
    base.listening = 0;
  }
  const disabled: Partial<Record<FlashcardType, boolean>> = {
    native_to_target: !options.flags.production,
    cloze: !options.flags.cloze,
    listening: !options.flags.listening
  };
  for (const type of ALL_TYPES) {
    if (disabled[type] && base[type] > 0) {
      base.target_to_native += base[type];
      base[type] = 0;
    }
  }
  return base;
}

// Deterministic per word: same deck seed → same assignment.
export function chooseCardTypes<T extends { id: string; fields: { review_state?: string } }>(
  words: T[],
  options: { seed: string; audioEnabled: boolean; flags: CardTypeFlags }
): FlashcardType[] {
  return words.map((word) => {
    const weights = cardTypeWeights(word.fields.review_state, options);
    const roll = (hashSeed(`${options.seed}:${word.id}`) % 10_000) / 10_000;
    let cumulative = 0;
    for (const type of ALL_TYPES) {
      cumulative += weights[type];
      if (roll < cumulative) return type;
    }
    return "target_to_native";
  });
}

export function countPlannedTypes(types: FlashcardType[]) {
  return {
    targetToNative: types.filter((type) => type === "target_to_native").length,
    nativeToTarget: types.filter((type) => type === "native_to_target").length,
    cloze: types.filter((type) => type === "cloze").length,
    listening: types.filter((type) => type === "listening").length
  };
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `npx vitest run tests/unit/flashcard-type-selection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcard-type-selection.ts tests/unit/flashcard-type-selection.test.ts
git commit -m "feat(review): per-stage card type selection with audio and rollout flags"
```

---

### Task 2: Integração no deck (`buildDeck` + `createFlashcardPractice`)

**Files:**
- Modify: `lib/learning/flashcards.ts:155-159,188-262,264-266,622-633` (remover `getActiveRecallDistribution`, flags env, wiring do deck, distribution real no `configuration_json`, comentário do retreino)
- Modify: `.env.example:70` (flags novas)
- Test: `tests/unit/flashcards.test.ts`

**Interfaces:**
- Consumes: `chooseCardTypes`, `countPlannedTypes`, `CardTypeFlags` (Task 1).
- Produces:
  - `getCardTypeFlags(): CardTypeFlags` (flashcards.ts, lê `FLASHCARD_PRODUCTION_ENABLED`/`FLASHCARD_CLOZE_ENABLED`/`FLASHCARD_LISTENING_ENABLED` via `getEnv`, default true)
  - `buildDeck(words, language, level, seed, desiredTypes: FlashcardType[])` — nova assinatura (5º parâmetro obrigatório)
  - `getActiveRecallDistribution` é **removido**; `configuration_json.distribution` passa a refletir os tipos planejados reais

- [ ] **Step 1: Ajustar os testes existentes que falham**

Em `tests/unit/flashcards.test.ts`:

1. Remover `getActiveRecallDistribution` do import e apagar o teste `"builds every card target_to_native (learned language → Portuguese)"`.
2. Adicionar `getCardTypeFlags` ao import e este novo describe:

```ts
describe("card type rollout flags", () => {
  const ENV_KEYS = ["FLASHCARD_PRODUCTION_ENABLED", "FLASHCARD_CLOZE_ENABLED", "FLASHCARD_LISTENING_ENABLED"] as const;
  afterEach(() => { for (const key of ENV_KEYS) delete process.env[key]; });

  it("defaults every type to enabled", () => {
    expect(getCardTypeFlags()).toEqual({ production: true, cloze: true, listening: true });
  });

  it("disables a type only on the explicit value 'false'", () => {
    process.env.FLASHCARD_CLOZE_ENABLED = "false";
    process.env.FLASHCARD_LISTENING_ENABLED = "FALSE";
    process.env.FLASHCARD_PRODUCTION_ENABLED = "0";
    expect(getCardTypeFlags()).toEqual({ production: true, cloze: false, listening: false });
  });
});
```

(`afterEach` já é importado de `vitest` no arquivo? Verificar o import no topo e fundir se necessário.)

3. Adicionar um teste de buildDeck com tipos mistos (IA de frases falha sem rede → cloze degrada para os fallbacks determinísticos, o que o teste explora):

```ts
describe("buildDeck with mixed types", () => {
  it("builds production cards from the translation when requested", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "house", review_state: "review" }),
      word("perro", { display_text: "perro", translation: "dog", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-1", ["native_to_target", "target_to_native"]);
    const production = deck.cards.find((card) => card.targetWordId === "casa")!;
    expect(production.type).toBe("native_to_target");
    expect(production.prompt).toBe("house");
    expect(production.expectedAnswer).toBe("casa");
    expect(production.acceptedAnswers).toEqual([]);
    const comprehension = deck.cards.find((card) => card.targetWordId === "perro")!;
    expect(comprehension.type).toBe("target_to_native");
    expect(comprehension.prompt).toBe("perro");
  }, 15_000);

  it("degrades cloze to deterministic types when no phrase validates", async () => {
    const deck = await buildDeck([
      word("casa", { display_text: "casa", translation: "house", review_state: "review" })
    ], "Espanhol", "Intermediário (B1)", "seed-2", ["cloze"]);
    expect(["native_to_target", "target_to_native"]).toContain(deck.cards[0].type);
    expect(deck.adapted).toBe(true);
  }, 15_000);
});
```

(Adicionar `buildDeck` ao import do arquivo; a factory `word()` existente aceita `Partial<WordFields>`. O timeout de 15s cobre a tentativa de IA com timeout de 8s.)

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/flashcards.test.ts`
Expected: FAIL — `getCardTypeFlags is not exported` / `buildDeck` com 5 argumentos não existe / referência a `getActiveRecallDistribution` removido

- [ ] **Step 3: Implementar em flashcards.ts**

1. Imports: adicionar `import { chooseCardTypes, countPlannedTypes, type CardTypeFlags } from "./flashcard-type-selection";` e `type FlashcardType` ao import de `./flashcard-contracts`.
2. **Remover** `getActiveRecallDistribution` (linhas ~155-159, incluindo o comentário "A revisão inteligente é sempre idioma estudado → português").
3. Adicionar após `isFlashcardActiveRecallEnabled`:

```ts
export function getCardTypeFlags(): CardTypeFlags {
  const enabled = (name: string) => getEnv(name)?.toLowerCase() !== "false";
  return {
    production: enabled("FLASHCARD_PRODUCTION_ENABLED"),
    cloze: enabled("FLASHCARD_CLOZE_ENABLED"),
    listening: enabled("FLASHCARD_LISTENING_ENABLED")
  };
}
```

4. Nova assinatura do `buildDeck` (linhas ~622-633):

```ts
export async function buildDeck(words: TeableRecord<WordFields>[], language: string, level: string, seed: string, desiredTypes: FlashcardType[]) {
  const planned = countPlannedTypes(desiredTypes);
  const phrases = await generatePhrases(words, language, level);
  const cards = words.map((word, index) => buildActiveRecallCard(word, desiredTypes[index] ?? "target_to_native", phrases.get(word.id), index));
  return { cards: seededShuffle(cards, seed), planned, adapted: cards.filter((card) => card.type === "cloze").length < planned.cloze };
}
```

5. Em `createFlashcardPractice`, logo após a seleção das palavras (`selected`) e antes do `createRecord`:

```ts
  const desiredTypes = chooseCardTypes(selected, {
    seed: `${user.id}:${profile.id}:${Date.now()}`,
    audioEnabled: Boolean(profile.fields.audio_enabled),
    flags: getCardTypeFlags()
  });
  const plannedDistribution = countPlannedTypes(desiredTypes);
```

(Seed com `Date.now()` porque o `deckSeed` UUID só é gerado depois do `createRecord`; a atribuição de tipo não precisa ser reproduzível entre sessões — apenas determinística por palavra dentro da sessão.)

6. No `createRecord` inicial, trocar `configuration_json: JSON.stringify({ distribution: getActiveRecallDistribution(selected.length) })` por:

```ts
    configuration_json: JSON.stringify({ distribution: plannedDistribution }),
```

7. Na chamada do deck, trocar `deck = await buildDeck(selected, profile.fields.language_name || profile.fields.language_code, profile.fields.level || "intermediário", deckSeed);` por:

```ts
    deck = await buildDeck(selected, profile.fields.language_name || profile.fields.language_code, profile.fields.level || "intermediário", deckSeed, desiredTypes);
```

8. No `updateRecord` pós-deck, trocar `configuration_json: JSON.stringify({ distribution: getActiveRecallDistribution(selected.length), deckSeed, adapted: deck.adapted })` por:

```ts
      configuration_json: JSON.stringify({ distribution: deck.planned, deckSeed, adapted: deck.adapted }),
```

9. Em `createFlashcardRetraining` (linha ~265), trocar o comentário `// Cards são sempre target_to_native; retreinos por tipo de card (produção/escuta) não existem mais.` por:

```ts
  // Retreinos reutilizam o deck misto por estágio; o modo filtra as palavras elegíveis.
```

10. Em `.env.example`, após `FLASHCARD_ACTIVE_RECALL_ENABLED=true`, adicionar:

```
# Optional per-type rollout flags for the smart review card mix (default: enabled).
FLASHCARD_PRODUCTION_ENABLED=true
FLASHCARD_CLOZE_ENABLED=true
FLASHCARD_LISTENING_ENABLED=true
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `npx vitest run tests/unit/flashcards.test.ts tests/unit/flashcard-type-selection.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/learning/flashcards.ts tests/unit/flashcards.test.ts .env.example
git commit -m "feat(review): build mixed-type decks from per-stage selection"
```

---

### Task 3: Preview de intervalo por rating (`intervalPreviewDays`)

**Files:**
- Modify: `lib/learning/spaced-repetition.ts` (nova função exportada, após `reviewToWordFields`)
- Modify: `lib/learning/flashcard-contracts.ts:14-29` (`Flashcard.intervalPreviewDays`)
- Modify: `lib/learning/flashcards.ts` (anexar preview na criação e no resume)
- Test: `tests/unit/spaced-repetition.test.ts`

**Interfaces:**
- Consumes: `calculateAdaptiveReview` (existente, mesmo arquivo).
- Produces:
  - `previewReviewIntervals(current: ReviewFields, now?: Date, timeZone?: string, fuzzSeed?: string): Record<RecallRating, number>` — dias até o próximo vencimento para cada rating (mínimo 1)
  - `Flashcard.intervalPreviewDays?: Partial<Record<RecallRating, number>>` — presente nos cards retornados por `createFlashcardPractice` e `getActiveFlashcardPractice` (NÃO persistido no Teable)

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `tests/unit/spaced-repetition.test.ts` (importar `previewReviewIntervals`; verificar o estilo de factory de `ReviewFields` usado no arquivo e segui-lo):

```ts
describe("previewReviewIntervals", () => {
  const NOW = new Date("2026-08-02T12:00:00.000Z");

  it("previews a new word's learning steps without fuzz", () => {
    // good avança 1 passo (1d); easy avança 2 passos (3d) — graduação exige passar do último passo.
    const preview = previewReviewIntervals({ review_state: "new" }, NOW, "UTC", "w1");
    expect(preview).toEqual({ forgot: 1, hard: 1, good: 1, easy: 3 });
  });

  it("previews a graduated word with the fuzzed interval bounded", () => {
    const preview = previewReviewIntervals(
      { review_state: "review", review_interval_days: 3, review_streak: 1, review_ease: 2.3, learning_step: 3 },
      NOW, "UTC", "w2"
    );
    expect(preview.forgot).toBe(1);
    expect(preview.hard).toBeGreaterThanOrEqual(1);
    expect(preview.good).toBeGreaterThanOrEqual(6);
    expect(preview.good).toBeLessThanOrEqual(8);
    expect(preview.easy).toBeGreaterThan(preview.good);
  });

  it("is deterministic for the same fuzz seed", () => {
    const current = { review_state: "review" as const, review_interval_days: 30, review_streak: 4, review_ease: 2.5, learning_step: 3 };
    expect(previewReviewIntervals(current, NOW, "America/Sao_Paulo", "w3")).toEqual(previewReviewIntervals(current, NOW, "America/Sao_Paulo", "w3"));
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/spaced-repetition.test.ts`
Expected: FAIL — `previewReviewIntervals is not exported`

- [ ] **Step 3: Implementar em spaced-repetition.ts**

Adicionar após `reviewToWordFields` (linha ~140):

```ts
// Per-rating preview of the next due distance in days (for the rating buttons' micro-feedback).
export function previewReviewIntervals(current: ReviewFields, now = new Date(), timeZone = "UTC", fuzzSeed = ""): Record<RecallRating, number> {
  const preview = {} as Record<RecallRating, number>;
  for (const rating of ["forgot", "hard", "good", "easy"] as const) {
    const review = calculateAdaptiveReview(current, [{ rating }], now, timeZone, fuzzSeed);
    preview[rating] = Math.max(1, Math.round((Date.parse(review.reviewDueAt) - now.getTime()) / DAY_MS));
  }
  return preview;
}
```

- [ ] **Step 4: Contrato + wiring nos cards**

1. Em `lib/learning/flashcard-contracts.ts`, no tipo `Flashcard`, adicionar após `generationSource?`:

```ts
  intervalPreviewDays?: Partial<Record<RecallRating, number>>;
```

2. Em `lib/learning/flashcards.ts`, adicionar `previewReviewIntervals` ao import de `./spaced-repetition`.
3. Em `createFlashcardPractice`, logo após o loop que cria os records e preenche `cards` (dentro do `try`, antes do `updateRecord`):

```ts
    const previewNow = new Date();
    cards = cards.map((card) => {
      const cardWord = selected.find((item) => item.id === card.targetWordId);
      return cardWord ? { ...card, intervalPreviewDays: previewReviewIntervals(cardWord.fields, previewNow, timeZone, cardWord.id) } : card;
    });
```

4. Em `getActiveFlashcardPractice`, trocar o `Promise.all` por:

```ts
  const [cardRecords, attemptRecords, wordRecords] = await Promise.all([
    client.listRecords<FlashcardFields>("flashcards", 500),
    client.listRecords<FlashcardAttemptFields>("flashcardAttempts", 1000),
    client.listRecords<WordFields>("words", 500)
  ]);
```

e, após o `map` que produz `cards`, adicionar:

```ts
  const previewNow = new Date();
  const wordsById = new Map(wordRecords.map((word) => [word.id, word]));
  const cardsWithPreview = cards.map((card) => {
    const word = wordsById.get(card.targetWordId);
    return word ? { ...card, intervalPreviewDays: previewReviewIntervals(word.fields, previewNow, user.fields.timezone ?? "UTC", word.id) } : card;
  });
```

Usar `cardsWithPreview` no lugar de `cards` no `rebuildFlashcardQueue` e no objeto retornado (renomear a constante original para manter o fluxo claro).

- [ ] **Step 5: Rodar e verificar que passa**

Run: `npx vitest run tests/unit/spaced-repetition.test.ts tests/unit/flashcards.test.ts tests/unit/flashcard-api.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/learning/spaced-repetition.ts lib/learning/flashcard-contracts.ts lib/learning/flashcards.ts tests/unit/spaced-repetition.test.ts
git commit -m "feat(review): per-rating interval preview on session cards"
```

---

### Task 4: UI — micro-feedback nos botões + métricas por competência

**Files:**
- Modify: `components/FlashcardTrainer.tsx` (captions nos 4 botões; linhas Produção/Escuta no resultado)
- Test: `tests/e2e/qa-flow.spec.ts` (enriquecer o teste frozen-deck existente)

**Interfaces:**
- Consumes: `Flashcard.intervalPreviewDays` (Task 3); `FlashcardPracticeResult.productionAccuracy`/`listeningAccuracy` (já existentes no contrato e no payload do complete).
- Produces: botões de rating com caption `→ N dia(s)`; resultado com linhas "Produção" e "Escuta".

- [ ] **Step 1: Enriquecer o teste e2e existente (falha antes da UI)**

Em `tests/e2e/qa-flow.spec.ts`, no teste `"mobile flashcard training completes a frozen deck once"`:

1. No mock do POST de criação, adicionar ao `card-a`:

```ts
intervalPreviewDays: { forgot: 1, hard: 2, good: 7, easy: 15 }
```

2. No mock do complete, adicionar ao body: `productionAccuracy: 50, listeningAccuracy: null`.
3. Após o primeiro reveal (`await expect(page.getByText("Resposta exata")).toBeVisible();`), adicionar:

```ts
  await expect(page.getByText("→ 7 dias")).toBeVisible();
  await expect(page.getByText("→ 1 dia")).toBeVisible();
```

4. Junto da asserção final do resultado, adicionar:

```ts
  await expect(page.getByText("Produção")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();
```

- [ ] **Step 2: Rodar o e2e e verificar que falha**

Run: `npm run build && npx playwright test tests/e2e/qa-flow.spec.ts -g "frozen deck"`
Expected: FAIL — `→ 7 dias` / `Produção` não encontrados

- [ ] **Step 3: Implementar na UI**

Em `components/FlashcardTrainer.tsx`:

1. Helper (junto de `formatAccuracy`, no fim do arquivo):

```ts
function formatIntervalDays(days: number) { return `${days} ${days === 1 ? "dia" : "dias"}`; }
```

2. Nos 4 botões de rating (bloco `recall-rating-grid`), adicionar a caption dentro de cada botão, após o label:

```tsx
          <button className={revealed.suggestedRating === "forgot" ? "suggested" : ""} disabled={busy} onClick={() => grade("forgot")} type="button"><X /> Não lembrei{card.intervalPreviewDays?.forgot ? <span className="interval-hint">→ {formatIntervalDays(card.intervalPreviewDays.forgot)}</span> : null}</button>
          <button className={revealed.suggestedRating === "hard" ? "suggested" : ""} disabled={busy} onClick={() => grade("hard")} type="button">Difícil{card.intervalPreviewDays?.hard ? <span className="interval-hint">→ {formatIntervalDays(card.intervalPreviewDays.hard)}</span> : null}</button>
          <button className={revealed.suggestedRating === "good" ? "suggested" : ""} disabled={busy} onClick={() => grade("good")} type="button"><Check /> Lembrei{card.intervalPreviewDays?.good ? <span className="interval-hint">→ {formatIntervalDays(card.intervalPreviewDays.good)}</span> : null}</button>
          <button className={revealed.suggestedRating === "easy" ? "suggested" : ""} disabled={busy} onClick={() => grade("easy")} type="button"><Sparkles /> Fácil{card.intervalPreviewDays?.easy ? <span className="interval-hint">→ {formatIntervalDays(card.intervalPreviewDays.easy)}</span> : null}</button>
```

(A variável `card` já existe no topo desse bloco de render: `const card = cards.find((candidate) => candidate.id === currentItem.cardId);`.)

3. Na grade de detalhes do resultado (logo após a linha "Compreensão"), inserir:

```tsx
<div><span>Produção</span><strong>{formatAccuracy(result.productionAccuracy)}</strong></div><div><span>Escuta</span><strong>{formatAccuracy(result.listeningAccuracy)}</strong></div>
```

4. CSS: em `app/globals.css`, na regra `.recall-rating-grid button` (em torno da linha 1920, que hoje é `display: flex; align-items: center; justify-content: center; gap: 5px;`), adicionar `flex-direction: column;` para que a caption fique embaixo do label. E adicionar ao final do arquivo:

```css
.interval-hint { display: block; font-size: 11px; opacity: 0.7; font-weight: 400; }
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `npm run build && npx playwright test tests/e2e/qa-flow.spec.ts -g "frozen deck"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/FlashcardTrainer.tsx tests/e2e/qa-flow.spec.ts app/globals.css
git commit -m "feat(review): interval micro-feedback on rating buttons and real competence metrics"
```

---

### Task 5: Verificação completa + e2e de sessão mista

**Files:**
- Test: `tests/e2e/qa-flow.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–4.

- [ ] **Step 1: Teste e2e de card de escuta com preview**

Adicionar a `tests/e2e/qa-flow.spec.ts`, após o teste do fluxo diário:

```ts
test("listening card plays audio prompt and shows interval hints", async ({ page }) => {
  await page.route("**/api/practice/flashcards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, activeSession: null }) });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "session-listen",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-listen", sessionId: "session-listen", type: "listening", targetWordId: "word-l", supportingWordIds: [], prompt: "", expectedAnswer: "hola", acceptedAnswers: [], translation: "olá", audioText: "hola", difficulty: 3, intervalPreviewDays: { forgot: 1, hard: 3, good: 7, easy: 16 } }
        ]
      })
    });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await expect(page.getByLabel("Card de escuta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvir áudio" })).toBeVisible();
  await page.getByRole("textbox", { name: "Resposta esperada em português" }).fill("olá");
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("→ 7 dias")).toBeVisible();
});
```

(O `page.route("**/api/voice/synthesize")` do `beforeEach` existente já cobre o áudio.)

- [ ] **Step 2: Verificação completa local**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build && npx playwright test tests/e2e/qa-flow.spec.ts -g "flashcard|daily|listening"`
Expected: tudo verde (unit 220+; e2e 5+ testes)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/qa-flow.spec.ts
git commit -m "test(review): cover listening card flow end to end"
```

- [ ] **Step 4: Runbook operacional (orquestrador, após merge)**

1. `npm run build` e `npm run test:integration` (32 assertions; a sessão criada pelo script agora pode ter tipos mistos — as tentativas respondem `card.expectedAnswer`, então o fluxo permanece válido).
2. Nenhuma migração Teable neste PR.
3. Flags de rollout: para desligar um tipo em produção, definir `FLASHCARD_<TIPO>_ENABLED=false` no ambiente (sem deploy).
4. Push só com autorização explícita do usuário.

---

## Notas de escopo (o que este PR NÃO faz)

- Não cria `sentence_translation` nem avaliação por IA (PR D).
- Não adiciona formas flexionadas novas às respostas aceitas (mecanismo atual de `acceptedAnswers` + `minor_error` cobre o prometido neste PR).
- Não muda scans server-side nem atualiza docs desatualizados (PR E).
- Não persiste o preview de intervalo (recomputado na criação e no resume; se um dia virar coluna, será migração aditiva separada).
