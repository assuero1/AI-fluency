# Traduções de Palavras — Prevenção e Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que nenhuma palavra seja salva sem tradução (prevenção em `lib/learning/vocabulary-selection.ts`) e traduzir as ~169 palavras existentes sem tradução em produção (script único `scripts/backfill-word-translations.mjs`).

**Architecture:** Três mudanças no fluxo de salvamento de vocabulário — parâmetros de IA mais robustos na análise em lote, uma segunda passagem de tradução em lotes pequenos quando o lote principal deixa traduções vazias, e um guarda que pula a criação de palavras novas sem tradução — mais um script de backfill idempotente no padrão dos scripts existentes (`qa-env.mjs`, dry-run por padrão, `--apply` exige `--backup`).

**Tech Stack:** Next.js / TypeScript (`lib/`), Vitest (`tests/unit/`), Node ESM scripts (`scripts/*.mjs`), Teable REST API.

**Spec:** `docs/superpowers/specs/2026-08-06-word-translations-design.md`

**Desvio da spec (intencional):** a spec dizia para chamar o fallback de tradução dentro de `analyzeConversationVocabulary`; o plano o coloca ao final de `analyzeVocabulary`. Efeito idêntico (o cache de análise já guarda as traduções do fallback e tanto o GET de candidatos quanto o POST de salvamento passam por `analyzeVocabulary`), com menos código.

## Global Constraints

- Não migrar schema: o campo `translation` (text) já existe na tabela `words` (`lib/teable/schema.ts:184`).
- Invariante: toda palavra **nova** criada na tabela `words` tem `translation` não vazia.
- Falhas de IA logam com `console.error` (nunca `console.warn` silencioso) e contexto (quantidade de itens, idioma).
- Parâmetros da análise principal: `temperature: 0, maxTokens: 2_000, timeoutMs: 15_000`. Fallback de tradução: `temperature: 0, maxTokens: 800, timeoutMs: 15_000`, lotes de 5.
- Testes unitários rodam com `npm run test:unit` (vitest). Lint com `npm run lint`.
- O script de backfill: dry-run por padrão; `--apply` exige `--backup <arquivo>`; PATCH no Teable usa o body `{ record: { fields } }` e `?fieldKeyType=name`; idempotente (só processa palavras ainda vazias).
- Não executar `--apply` em produção sem confirmação explícita do usuário.

---

### Task 1: Endurecer parâmetros da análise em lote e tornar falhas ruidosas

**Files:**
- Modify: `lib/learning/vocabulary-selection.ts:657-695` (`analyzeVocabularyChunk`)
- Test: `tests/unit/vocabulary-selection.test.ts:206-241` (`describe("batched linguistic analysis")`)

**Interfaces:**
- Consumes: `createChatCompletion(messages, { temperature, maxTokens, timeoutMs })` de `lib/ai/client.ts:41` (mockado no teste via `vi.mock("../../lib/ai/client")`).
- Produces: `analyzeVocabularyChunk` continua retornando `Record<string, VocabularyLinguisticData>`; nenhuma assinatura muda. Tasks 2 e 3 assumem os logs em `console.error`.

- [ ] **Step 1: Atualizar os testes existentes (ficam vermelhos)**

Em `tests/unit/vocabulary-selection.test.ts`, dentro de `describe("batched linguistic analysis")`:

a) No teste `"splits large candidate sets into chunks of at most 20"` (linha ~214), trocar a asserção de parâmetros:

```ts
      expect(createChatCompletion.mock.calls[0][1]).toMatchObject({ maxTokens: 2_000, timeoutMs: 15_000 });
```

b) Nos testes `"warns and falls back when a chunk fails instead of swallowing the error"` (linha ~217) e `"warns when the chunk response is not parseable JSON"` (linha ~232), trocar o spy de `console.warn` para `console.error` e renomear os testes:

```ts
    it("logs an error and falls back when a chunk fails instead of swallowing it", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ content: "[]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = Array.from({ length: 25 }, (_, index) => buildCandidate(`user:working${index}`, "user", 1));

      const groups = await groupNewVocabularyCandidates(candidates, [], "en");

      expect(error).toHaveBeenCalled();
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((group) => group.lemma.startsWith("working"))).toBe(true);
    });

    it("logs an error when the chunk response is not parseable JSON", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockResolvedValue({ content: "[{not json]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates([buildCandidate("user:working", "user", 1)], [], "en");

      expect(error).toHaveBeenCalled();
    });
```

(Os corpos são os mesmos de hoje; mudam apenas o spy `warn` → `error` e os títulos.)

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: FAIL — asserção de `maxTokens: 2000` falha (atual é 600) e os spies de `console.error` não são chamados.

- [ ] **Step 3: Implementar**

Em `lib/learning/vocabulary-selection.ts`, `analyzeVocabularyChunk` (linhas 657-695), três mudanças:

a) Linha 666 — novos parâmetros:

```ts
    ], { temperature: 0, maxTokens: 2_000, timeoutMs: 15_000 });
```

b) Linhas 668-671 — log ruidoso com contexto:

```ts
  } catch (error) {
    console.error(`Vocabulary analysis failed for ${chunk.length} candidate(s) in ${language}; keeping fallback lemmas.`, error);
    return {} as Record<string, VocabularyLinguisticData>;
  }
```

c) Linhas 691-694 — idem no catch de parse:

```ts
  } catch (error) {
    console.error(`Vocabulary analysis response could not be parsed for ${chunk.length} candidate(s) in ${language}; keeping fallback lemmas.`, error);
    return {} as Record<string, VocabularyLinguisticData>;
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/vocabulary-selection.ts tests/unit/vocabulary-selection.test.ts
git commit -m "fix(vocabulary): raise analysis timeout/tokens and log chunk failures as errors"
```

---

### Task 2: Fallback de tradução em lotes pequenos dentro de `analyzeVocabulary`

**Files:**
- Modify: `lib/learning/vocabulary-selection.ts:53-56` (constantes) e `:641-655` (`analyzeVocabulary`)
- Test: `tests/unit/vocabulary-selection.test.ts` (novo `describe("translation fallback")`)

**Interfaces:**
- Consumes: `analyzeVocabularyChunk` (Task 1), `VocabularyCandidate`, `VocabularyLinguisticData`.
- Produces: `analyzeVocabulary(candidates, language)` passa a garantir segunda tentativa de tradução; nova constante `VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE = 5` e nova função interna `translateMissingTranslations(analyses: Record<string, VocabularyLinguisticData>, candidates: VocabularyCandidate[], language: string): Promise<void>` (não exportada). Task 3 depende deste comportamento no salvamento.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `tests/unit/vocabulary-selection.test.ts`, após o `describe("batched linguistic analysis")`:

```ts
  describe("translation fallback", () => {
    it("retries missing translations in small batches before grouping", async () => {
      createChatCompletion
        .mockResolvedValueOnce({
          content: JSON.stringify([{ id: "user:biblioteca", lemma: "biblioteca", translation: "", part_of_speech: "noun" }]),
          tokensUsed: 1
        })
        .mockResolvedValueOnce({
          content: JSON.stringify([{ id: "user:biblioteca", translation: "biblioteca" }]),
          tokensUsed: 1
        });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:biblioteca", "user", 1)], [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(createChatCompletion.mock.calls[1][1]).toMatchObject({ maxTokens: 800, timeoutMs: 15_000 });
      expect(groups[0].translation).toBe("biblioteca");
    });

    it("keeps empty translations and logs an error when the fallback also fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockRejectedValue(new Error("provider down"));
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:working", "user", 1)], [], "en");

      expect(error).toHaveBeenCalled();
      expect(groups[0].translation).toBe("");
    });

    it("skips the fallback call when every candidate already has a translation", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:casa", lemma: "casa", translation: "house", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates([buildCandidate("user:casa", "user", 1)], [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });
  });
```

Nota: o teste existente `"reuses the picker analysis when saving so lemmas cannot diverge"` (linha ~244) já protege o caminho com cache: como todas as análises vêm com tradução, nenhuma chamada extra pode ocorrer (ele asserta `toHaveBeenCalledTimes(1)` após o GET e após o save).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: FAIL — o primeiro teste espera 2 chamadas e tradução preenchida; hoje só há 1 chamada e tradução vazia.

- [ ] **Step 3: Implementar**

Em `lib/learning/vocabulary-selection.ts`:

a) Junto às constantes (linhas 53-56), adicionar:

```ts
const VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE = 5;
```

b) Ao final de `analyzeVocabulary` (linhas 641-655), chamar o fallback antes de retornar:

```ts
async function analyzeVocabulary(candidates: VocabularyCandidate[], language: string) {
  const merged = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    lemma: fallbackVocabularyLemma(candidate.normalized, language),
    translation: "",
    partOfSpeech: ""
  }])) as Record<string, VocabularyLinguisticData>;
  // Batching keeps each response small enough to avoid the truncated JSON that
  // used to push every candidate silently onto the fallback lemma. Chunks run
  // sequentially to stay clear of provider rate limits.
  for (let index = 0; index < candidates.length; index += VOCABULARY_ANALYSIS_CHUNK_SIZE) {
    const chunk = candidates.slice(index, index + VOCABULARY_ANALYSIS_CHUNK_SIZE);
    Object.assign(merged, await analyzeVocabularyChunk(chunk, language));
  }
  await translateMissingTranslations(merged, candidates, language);
  return merged;
}
```

c) Logo após `analyzeVocabularyChunk` (após a linha 695), adicionar a nova função:

```ts
/**
 * Second chance for candidates whose chunked analysis came back without a
 * translation (timeout, truncated JSON, etc.). Small batches with a simpler
 * prompt keep the failure blast radius per-word instead of per-chunk. Words
 * that stay untranslated after this pass are handled by the caller (new words
 * are not persisted without a translation).
 */
async function translateMissingTranslations(
  analyses: Record<string, VocabularyLinguisticData>,
  candidates: VocabularyCandidate[],
  language: string
) {
  const missing = candidates.filter((candidate) => !analyses[candidate.id]?.translation);
  for (let index = 0; index < missing.length; index += VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE) {
    const batch = missing.slice(index, index + VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE);
    let content: string;
    try {
      const response = await createChatCompletion([
        {
          role: "system",
          content: "Traduza cada item para português brasileiro. Responda somente JSON válido: um array com objetos {id, translation}. Preserve cada id exatamente."
        },
        { role: "user", content: `Idioma: ${language}\nItens: ${JSON.stringify(batch.map((candidate) => ({ id: candidate.id, text: candidate.text, context: candidate.context })))}` }
      ], { temperature: 0, maxTokens: 800, timeoutMs: 15_000 });
      content = response.content;
    } catch (error) {
      console.error(`Translation fallback failed for ${batch.length} candidate(s) in ${language}.`, error);
      continue;
    }
    const allowedIds = new Set(batch.map((candidate) => candidate.id));
    for (const [id, translation] of Object.entries(parseTranslationItems(content, allowedIds))) {
      const analysis = analyses[id];
      if (analysis && !analysis.translation) analysis.translation = translation;
    }
  }
}

function parseTranslationItems(content: string, allowedIds: Set<string>) {
  const result: Record<string, string> = {};
  try {
    const match = content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return result;
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || !allowedIds.has(item.id)) continue;
      const translation = typeof item.translation === "string" ? item.translation.trim() : "";
      if (translation) result[item.id] = translation;
    }
  } catch (error) {
    console.error("Translation fallback response could not be parsed.", error);
  }
  return result;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os das Tasks anteriores).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/vocabulary-selection.ts tests/unit/vocabulary-selection.test.ts
git commit -m "feat(vocabulary): retry missing translations in small fallback batches"
```

---

### Task 3: Não criar palavras novas sem tradução

**Files:**
- Modify: `lib/learning/vocabulary-selection.ts:460-488` (ramo de criação em `persistSelectedVocabulary`)
- Test: `tests/unit/vocabulary-selection.test.ts` (novo `describe("translation requirement")`)

**Interfaces:**
- Consumes: `analyzeVocabulary` com fallback (Task 2) — `family.translation` só chega vazia se as duas passagens falharem.
- Produces: `saveSelectedVocabulary` pode retornar `newWordCount: 0` quando a IA falha totalmente; nenhuma assinatura muda.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `tests/unit/vocabulary-selection.test.ts`, após o `describe("translation fallback")`:

```ts
  describe("translation requirement", () => {
    it("does not create a new word when no translation could be generated", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
      messages = [buildMessage("m-solar", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-no-translation", ["user:solar"]);

      expect(result.newWordCount).toBe(0);
      expect(words).toHaveLength(0);
      expect(createRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
      expect(error).toHaveBeenCalled();
    });

    it("fills the translation of an existing word that was saved without one", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "solar",
          display_text: "solar",
          canonical_key: JSON.stringify(["user-1", "profile-1", "solar"]),
          forms_json: "[]",
          translation: "",
          part_of_speech: "",
          total_uses: 1,
          last_used_at: "2026-07-01T10:00:00.000Z",
          first_used_at: "2026-07-01T10:00:00.000Z"
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-solar-2", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-fill-translation", ["user:solar"]);

      expect(result.newWordCount).toBe(0);
      expect(result.updatedWordCount).toBe(1);
      expect(words[0].fields.translation).toBe("solar");
    });
  });
```

Nota: o segundo teste já passa hoje (o update da linha 504 preenche tradução vazia) — ele trava o comportamento contra regressão.

- [ ] **Step 2: Rodar os testes e confirmar que o primeiro falha**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: FAIL apenas em `"does not create a new word when no translation could be generated"` (hoje a palavra é criada com `translation: ""`).

- [ ] **Step 3: Implementar**

Em `lib/learning/vocabulary-selection.ts`, dentro do loop de famílias em `persistSelectedVocabulary`, no início do ramo `if (!word)` (linha 461):

```ts
    let createdWord = false;
    if (!word) {
      // A word without a translation is worse than no word: the Palavras tab
      // would show a permanent placeholder. The candidate stays available in
      // future conversations, when the AI analysis may succeed.
      if (!family.translation) {
        console.error(
          `Skipping new vocabulary word without translation (conversation ${conversationId}): "${family.lemma}" (${familyCandidates.length} candidate(s)).`
        );
        continue;
      }
      const fields: WordFields = {
```

(O restante do ramo — `const fields`, `try/catch` do `createRecord` — permanece inalterado.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/vocabulary-selection.ts tests/unit/vocabulary-selection.test.ts
git commit -m "feat(vocabulary): never create words without a translation"
```

---

### Task 4: Script de backfill `scripts/backfill-word-translations.mjs`

**Files:**
- Create: `scripts/backfill-word-translations.mjs`
- Create: `tests/unit/backfill-word-translations.test.ts`
- Modify: `types/mjs.d.ts`

**Interfaces:**
- Consumes: helpers de `scripts/qa-env.mjs` (`readEnv`, `required`, `teableRequest`, `recordsFrom`); env `TEABLE_WORDS_TABLE_ID`, `AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL` de `.env.local`.
- Produces (exportadas para teste):
  - `wordsMissingTranslation(records: Array<{ id: string; fields?: Record<string, unknown> }>): Array<record>` — filtra `fields.translation` vazia/ausente.
  - `chunkItems<T>(items: T[], size: number): T[][]`
  - `parseTranslationItems(content: string, allowedIds: Set<string>): Record<string, string>`
  - `translateWords(env: Record<string, string>, words: Array<record>, translate?: typeof translateBatch): Promise<Record<string, string>>` — lotes de 20, fallback em lotes de 5, retorna mapa `recordId → translation`.
- CLI: `node scripts/backfill-word-translations.mjs [--env <path>] [--apply --backup <arquivo.json>]`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/unit/backfill-word-translations.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { chunkItems, parseTranslationItems, translateWords, wordsMissingTranslation } from "../../scripts/backfill-word-translations.mjs";

describe("backfill-word-translations", () => {
  it("selects only words with empty or missing translations", () => {
    const records = [
      { id: "a", fields: { lemma: "house", translation: "casa" } },
      { id: "b", fields: { lemma: "work", translation: "" } },
      { id: "c", fields: { lemma: "gone" } },
      { id: "d", fields: { lemma: "run", translation: "  " } }
    ];

    expect(wordsMissingTranslation(records).map((record) => record.id)).toEqual(["b", "c", "d"]);
  });

  it("splits items into fixed-size chunks", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([], 5)).toEqual([]);
  });

  it("parses only known ids with non-empty translations", () => {
    const content = 'texto antes [{"id":"a","translation":"casa"},{"id":"b","translation":""},{"id":"x","translation":"foo"}] depois';

    expect(parseTranslationItems(content, new Set(["a", "b"]))).toEqual({ a: "casa" });
    expect(parseTranslationItems("not json", new Set(["a"]))).toEqual({});
  });

  it("falls back to small batches for words left without translation", async () => {
    const words = Array.from({ length: 21 }, (_, index) => ({
      id: `w${index}`,
      fields: { display_text: `word${index}`, translation: "" }
    }));
    const translate = vi.fn(async (_env: unknown, batch: Array<{ id: string }>) =>
      batch.length > 5 ? {} : Object.fromEntries(batch.map((item) => [item.id, `tr-${item.id}`]))
    );

    const translations = await translateWords({}, words, translate);

    expect(translate.mock.calls[0][1]).toHaveLength(20);
    expect(translate.mock.calls[1][1]).toHaveLength(1);
    const fallbackCalls = translate.mock.calls.slice(2);
    expect(fallbackCalls.every((call) => (call[1] as unknown[]).length <= 5)).toBe(true);
    expect(Object.keys(translations)).toHaveLength(21);
    expect(translations.w0).toBe("tr-w0");
  });
});
```

E atualizar `types/mjs.d.ts` adicionando as declarações dentro do `declare module "*.mjs"` existente:

```ts
  export function wordsMissingTranslation(records: Array<{ id: string; fields?: Record<string, unknown> }>): Array<{ id: string; fields?: Record<string, unknown> }>;
  export function chunkItems<T>(items: T[], size: number): T[][];
  export function parseTranslationItems(content: string, allowedIds: Set<string>): Record<string, string>;
  export function translateWords(
    env: Record<string, string>,
    words: Array<{ id: string; fields?: Record<string, unknown> }>,
    translate?: (env: Record<string, string>, batch: Array<{ id: string; text: string }>) => Promise<Record<string, string>>
  ): Promise<Record<string, string>>;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/backfill-word-translations.test.ts`
Expected: FAIL — módulo `../../scripts/backfill-word-translations.mjs` não existe.

- [ ] **Step 3: Implementar o script**

Criar `scripts/backfill-word-translations.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

const TRANSLATION_BATCH_SIZE = 20;
const TRANSLATION_FALLBACK_BATCH_SIZE = 5;
const AI_TIMEOUT_MS = 15_000;

export function wordsMissingTranslation(records) {
  return records.filter((record) => !String(record.fields?.translation ?? "").trim());
}

export function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function parseTranslationItems(content, allowedIds) {
  const result = {};
  try {
    const match = String(content ?? "").match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]");
    if (!Array.isArray(parsed)) return result;
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (typeof value.id !== "string" || !allowedIds.has(value.id)) continue;
      const translation = typeof value.translation === "string" ? value.translation.trim() : "";
      if (translation) result[value.id] = translation;
    }
  } catch (error) {
    console.error("Translation response could not be parsed.", error);
  }
  return result;
}

async function translateBatch(env, batch) {
  const baseUrl = required(env, "AI_BASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required(env, "AI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: required(env, "AI_CHAT_MODEL"),
      messages: [
        {
          role: "system",
          content: "Traduza cada item para português brasileiro. Responda somente JSON válido: um array com objetos {id, translation}. Preserve cada id exatamente."
        },
        { role: "user", content: `Itens: ${JSON.stringify(batch.map((item) => ({ id: item.id, text: item.text })))}` }
      ],
      temperature: 0,
      max_tokens: 2_000
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`AI translation request failed with ${response.status}.`);
  const body = await response.json();
  const content = String(body?.choices?.[0]?.message?.content ?? "").trim();
  return parseTranslationItems(content, new Set(batch.map((item) => item.id)));
}

export async function translateWords(env, words, translate = translateBatch) {
  const translations = {};
  const items = words.map((record) => ({
    id: record.id,
    text: String(record.fields?.display_text || record.fields?.lemma || record.fields?.Name || record.id)
  }));
  for (const batch of chunkItems(items, TRANSLATION_BATCH_SIZE)) {
    try {
      Object.assign(translations, await translate(env, batch));
    } catch (error) {
      console.error(`Translation batch failed for ${batch.length} word(s).`, error);
    }
  }
  const missing = items.filter((item) => !translations[item.id]);
  for (const batch of chunkItems(missing, TRANSLATION_FALLBACK_BATCH_SIZE)) {
    try {
      Object.assign(translations, await translate(env, batch));
    } catch (error) {
      console.error(`Translation fallback batch failed for ${batch.length} word(s).`, error);
    }
  }
  return translations;
}

async function main() {
  const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const envPath = option("--env") ?? ".env.local";
  const apply = process.argv.includes("--apply");
  const backupPath = option("--backup");
  if (apply && !backupPath) throw new Error("Use --backup <arquivo.json> ao executar com --apply.");
  const env = readEnv(envPath);
  const tableId = required(env, "TEABLE_WORDS_TABLE_ID");
  const records = [];
  for (let skip = 0; ; skip += 1000) {
    const page = recordsFrom(await teableRequest(env, `/api/table/${tableId}/record?take=1000&skip=${skip}&fieldKeyType=name`));
    records.push(...page);
    if (page.length < 1000) break;
  }
  const missing = wordsMissingTranslation(records);

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      missing: missing.length,
      sample: missing.slice(0, 20).map((record) => ({ id: record.id, lemma: record.fields?.lemma ?? record.fields?.display_text }))
    }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), words: missing }, null, 2)}\n`, { mode: 0o600, flag: "wx" });

  const translations = await translateWords(env, missing);
  let written = 0;
  const failed = [];
  for (const record of missing) {
    const translation = translations[record.id];
    if (!translation) { failed.push(record.id); continue; }
    try {
      await teableRequest(env, `/api/table/${tableId}/record/${record.id}?fieldKeyType=name`, {
        method: "PATCH",
        body: JSON.stringify({ record: { fields: { translation } } })
      });
      written += 1;
    } catch (error) {
      console.error(`Failed to write translation for record ${record.id}.`, error);
      failed.push(record.id);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    missing: missing.length,
    translated: Object.keys(translations).length,
    written,
    failed,
    backupPath
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/backfill-word-translations.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-word-translations.mjs tests/unit/backfill-word-translations.test.ts types/mjs.d.ts
git commit -m "feat(scripts): add word translation backfill script"
```

---

### Task 5: Verificação completa e dry-run em produção

**Files:**
- Nenhum arquivo novo; validação do conjunto.

**Interfaces:**
- Consumes: Tasks 1-4 concluídas.

- [ ] **Step 1: Suíte unitária completa**

Run: `npm run test:unit`
Expected: PASS — todos os arquivos, sem regressões (atenção especial a `vocabulary-selection.test.ts` e `backfill-word-translations.test.ts`).

- [ ] **Step 2: Lint e typecheck**

Run: `npm run lint && npm run typecheck`
Expected: sem erros nos arquivos tocados (`lib/learning/vocabulary-selection.ts`, `tests/unit/vocabulary-selection.test.ts`, `scripts/backfill-word-translations.mjs`, `tests/unit/backfill-word-translations.test.ts`, `types/mjs.d.ts`).

- [ ] **Step 3: Dry-run do backfill contra produção (somente leitura)**

Run: `node scripts/backfill-word-translations.mjs`
Expected: JSON com `"mode": "dry-run"` e `"missing"` próximo de 169 (pode variar se palavras foram salvas desde o backup de 2026-08-06), mais amostra de até 20 palavras. Nenhuma escrita no Teable.

- [ ] **Step 4: Reportar e aguardar ok para o apply**

Reportar ao usuário a contagem do dry-run. **Não** executar `--apply` sem confirmação explícita. Com o ok:

Run: `node scripts/backfill-word-translations.mjs --apply --backup backups/word-translations-$(date +%F).json`
Expected: JSON final com `written` igual ou próximo de `missing`, e `failed` listando ids restantes (reexecutável, pois o script é idempotente).

- [ ] **Step 5: Commit final (se houver ajustes da verificação)**

```bash
git add -A
git commit -m "chore(vocabulary): verify translation backfill dry-run"
```

---

## Self-Review

**1. Spec coverage:**
- Seção 1.1 (timeout 15s / maxTokens 2.000) → Task 1 ✓
- Seção 1.2 (fallback em lotes de 5, prompt dedicado, mescla sem sobrescrever) → Task 2 ✓ (colocado em `analyzeVocabulary` — desvio documentado no cabeçalho, mesmo efeito de cache e cobertura GET+POST)
- Seção 1.3 (palavra nova sem tradução não é salva; existentes continuam atualizando) → Task 3 ✓
- Seção 1.4 (console.error com contexto) → Tasks 1 e 2 ✓
- Seção 2 (script: dry-run, --apply exige --backup, lotes de 20 + fallback de 5, PATCH `fieldKeyType=name`, idempotente, relatório) → Task 4 ✓
- Seção 3 (testes unitários, lint, dry-run em produção, apply só com ok) → Task 5 ✓

**2. Placeholder scan:** nenhum TBD/TODO; todos os passos de código têm código completo.

**3. Type consistency:** `translateMissingTranslations` / `parseTranslationItems` (Task 2) têm assinaturas idênticas na spec do passo e na implementação; `wordsMissingTranslation` / `chunkItems` / `parseTranslationItems` / `translateWords` (Task 4) são consistentes entre script, teste e `types/mjs.d.ts`. Asserções de mock (`maxTokens: 2_000`, `maxTokens: 800`, `timeoutMs: 15_000`) batem com as implementações.
