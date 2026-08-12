# Chat Vocabulary Save — Performance, Filtro de Palavras da IA e Contagem por Sentido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acelerar o salvamento de vocabulário no fim do chat, excluir palavras usadas só pela IA do pipeline de salvamento e passar a contar/exibir usos por sentido, incluindo estatísticas de palavras nunca usadas.

**Architecture:** Filtro de candidatos `source !== "user"` na entrada do pipeline de análise/salvamento (`lib/learning/vocabulary-selection.ts`); substituição de full-table scans do Teable por queries filtradas (`listRecordsWhereAll` no client) no fluxo de salvamento e no resumo; eliminação do N+1 de `nextSenseOrder` e paralelização das gravações independentes por família; novo campo `total_uses` em `wordSenses` incrementado no salvamento; estatísticas novas nas telas Resumo e Palavras.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Teable self-hosted (REST), Vitest 4. Node >=20.19 <23.

**Spec:** `docs/superpowers/specs/2026-08-12-chat-vocabulary-save-design.md`

## Global Constraints

- Teable self-hosted pode ignorar o parâmetro `filter` silenciosamente (teableio/teable#3041): toda query filtrada nova deve manter o padrão de detecção + fallback client-side já existente em `TeableClient.listRecordsWhere` (`lib/teable/client.ts:194-223`).
- Textos de UI em pt-BR, seguindo o estilo das telas atuais.
- Não fazer backfill de `total_uses` de sentidos: sentidos pré-existentes começam em 0 (campo ausente = 0).
- Falha ao incrementar `total_uses` de um sentido NUNCA aborta o salvamento (log via `console.warn` e segue).
- Comandos de verificação do projeto: `npm run lint`, `npm run typecheck`, `npm run test:unit`.
- **Commits git somente após confirmação explícita do usuário** (política do ambiente). Os passos de commit abaixo devem ser apresentados ao usuário para aprovação antes de executar.
- Mensagens de commit em inglês, padrão conventional commits (`feat:`, `perf:`, `test:`).

---

### Task 1: Filtrar palavras da IA do pipeline de vocabulário

Candidatos com `source === "assistant"` deixam de entrar na análise LLM, no picker e no salvamento. A extração (`extractVocabularyOccurrences`/`extractVocabularyCandidates`) não muda — o filtro acontece nos call sites, então testes que chamam `groupNewVocabularyCandidates` diretamente com candidatos da IA (ranking) continuam válidos.

**Files:**
- Modify: `lib/learning/vocabulary-selection.ts` (nova função exportada + 2 call sites: `getConversationVocabularyGroups` ~linha 377, `persistSelectedVocabulary` ~linha 494)
- Modify: `components/VocabularyPicker.tsx` (remove seção "Palavras usadas pela IA")
- Test: `tests/unit/vocabulary-selection.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `extractUserVocabularyCandidates(messages: TeableRecord<MessageFields>[], corrections?: TeableRecord<CorrectionFields>[], language?: string): VocabularyCandidate[]` — igual a `extractVocabularyCandidates`, mas só `source === "user"`. Usada nas Tasks 2-4 (mesmo arquivo).

- [ ] **Step 1: Write the failing tests**

Adicionar ao final do `describe("vocabulary candidate selection")` em `tests/unit/vocabulary-selection.test.ts`:

```ts
  describe("assistant words exclusion", () => {
    it("rejects saving candidates that only the assistant used", async () => {
      messages = [buildMessage("m-ai", "assistant", "Serendipity ephemeral")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await expect(saveSelectedVocabulary("conversation-ai-only", ["assistant:serendipity"])).rejects.toThrow("Selecione ao menos uma palavra.");
      expect(words).toHaveLength(0);
    });

    it("does not offer assistant-only words in the picker groups", async () => {
      messages = [
        buildMessage("m-user", "user", "I enjoyed the concert"),
        buildMessage("m-ai", "assistant", "Serendipity ephemeral")
      ];
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:enjoyed", lemma: "enjoy", translation: "curtir", part_of_speech: "verb" },
          { id: "user:concert", lemma: "concert", translation: "show", part_of_speech: "noun" },
          { id: "assistant:serendipity", lemma: "serendipity", translation: "serendipidade", part_of_speech: "noun" }
        ]),
        tokensUsed: 1
      });
      const { getConversationVocabularyGroups } = await import("../../lib/learning/vocabulary-selection");

      const groups = await getConversationVocabularyGroups("conversation-ai-picker");

      expect(groups.every((group) => group.source === "user")).toBe(true);
      expect(groups.map((group) => group.lemma)).not.toContain("serendipity");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts -t "assistant words exclusion"`
Expected: FAIL — o primeiro teste resolve sem rejeitar (candidato da IA ainda é permitido); o segundo contém "serendipity" nos grupos.

- [ ] **Step 3: Implement the filter**

Em `lib/learning/vocabulary-selection.ts`, logo após `extractVocabularyCandidates` (após a linha ~293):

```ts
/**
 * Apenas palavras produzidas pelo usuário entram no pipeline de análise e
 * salvamento: sugestões que só apareceram em mensagens da IA não medem
 * domínio do aluno e inflam a análise (mais chunks de LLM, mais gravações).
 */
export function extractUserVocabularyCandidates(
  messages: TeableRecord<MessageFields>[],
  corrections: TeableRecord<CorrectionFields>[] = [],
  language = ""
) {
  return extractVocabularyCandidates(messages, corrections, language).filter((candidate) => candidate.source === "user");
}
```

Em `getConversationVocabularyGroups`, trocar a chamada (linha ~377):

```ts
  return groupNewVocabularyCandidates(
    extractUserVocabularyCandidates(context.messages, context.corrections, language),
```

Em `persistSelectedVocabulary`, trocar (linha ~494):

```ts
  const allowed = new Map(extractUserVocabularyCandidates(context.messages, context.corrections, language).map((item) => [item.id, item]));
```

Em `components/VocabularyPicker.tsx`:

1. Remover o array `sourceSections` (linhas 19-22).
2. Substituir o bloco `{sourceSections.map((group) => { ... })}` (linhas 77-100) por uma única seção:

```tsx
    {(() => {
      const items = candidateGroups ?? [];
      if (candidateGroups === null || items.length === 0) return null;
      const eligibleItems = items.filter((item) => item.eligible);
      const allSelected = eligibleItems.length > 0 && eligibleItems.every((item) => selected.has(item.id));
      return <div className="vocabulary-group">
        <div className="top-row"><h3 className="row-title">Palavras que você usou</h3>
          <button className="text-button" type="button" onClick={() => setSelected((current) => {
            const next = new Set(current); eligibleItems.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id)); return next;
          })}>{allSelected ? "Desmarcar todas" : "Selecionar todas"}</button>
        </div>
        <div className="vocabulary-options">
          {items.map((item) => <label className={selected.has(item.id) ? "vocabulary-option selected" : "vocabulary-option"} key={item.id}>
            <input checked={selected.has(item.id)} disabled={!item.eligible} onChange={() => toggle(item.id)} type="checkbox" />
            <span>
              {item.displayText}{item.occurrenceCount > 1 ? ` (${item.occurrenceCount}×)` : ""}
              {getVocabularyGroupBadge(item) ? <>{" "}<Pill tone="info">{getVocabularyGroupBadge(item)}</Pill></> : null}
              <small>{formatRelatedForms(item)}{getCandidateStatus(item)}</small>
              {getVocabularyGroupSubtitle(item) ? <small>{getVocabularyGroupSubtitle(item)}</small> : null}
            </span>{selected.has(item.id) ? <Check size={16} /> : null}
          </label>)}
        </div>
      </div>;
    })()}
```

3. Em `getCandidateStatus`, remover o branch da IA:

```ts
function getCandidateStatus(candidate: VocabularyCandidateGroup) {
  if (!candidate.eligible) return "Uso corrigido — não será salvo";
  if (candidate.incorrectOccurrenceCount > 0) return `${candidate.correctOccurrenceCount} uso(s) correto(s); usos corrigidos ignorados`;
  return "Novo uso do seu vocabulário";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS (todos, incluindo os ~30 existentes — o teste "shared analysis cache" mocka análise com ids `assistant:*`, que passa a ser inócuo porque esses candidatos não são mais analisados).

- [ ] **Step 5: Typecheck, lint e commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/learning/vocabulary-selection.ts components/VocabularyPicker.tsx tests/unit/vocabulary-selection.test.ts
git commit -m "feat: exclude assistant-only words from vocabulary saving pipeline"
```

---

### Task 2: `listRecordsWhereAll` no client Teable + leituras com escopo

Elimina os full-table scans do fluxo de salvamento e do resumo: `words` e `dailyFeedbacks` passam a ser lidos por `user_id` + `language_profile_id`; `wordUsageSummaries` por `conversation_id` (mais uma query por `word_id` para o `otherUses`); `users` por `getRecord` direto.

**Files:**
- Modify: `lib/teable/client.ts` (`listRecordsWhereAll` + `listRecordsWhere` delegando)
- Modify: `lib/learning/vocabulary-selection.ts` (leituras de `persistSelectedVocabulary` ~linhas 500-511 e 587-591, fallback de conflito ~linha 579, `getConversationVocabularyGroups` ~linhas 368-374, fallback de `upsertWordUsageSummary` ~linha 708)
- Modify: `lib/learning/feedback.ts` (`finalizeConversation` ~linhas 84-88, `getPersistedCompletion` ~linhas 152-156, `getConversationSummary` ~linhas 199-203)
- Test: `tests/unit/teable-client.test.ts` (novo)
- Test: `tests/unit/vocabulary-selection.test.ts` (mock do client + novos testes)

**Interfaces:**
- Consumes: `extractUserVocabularyCandidates` da Task 1 (mesmo arquivo, sem mudança de assinatura).
- Produces: `TeableClient.listRecordsWhereAll<TFields>(tableKey: TeableTableKey, filters: Array<{ field: string; value: string }>): Promise<TeableRecord<TFields>[]>` — usada nas Tasks 3 e 5.

- [ ] **Step 1: Write the failing client tests**

Criar `tests/unit/teable-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/teable/config", () => ({
  getTeableConfig: () => ({
    baseUrl: "https://teable.test",
    apiKey: "token",
    tableIds: { words: "tbl_words" }
  })
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(records: Array<{ id: string; fields: Record<string, unknown> }>) {
  return {
    ok: true,
    headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
    json: async () => ({ records })
  };
}

describe("listRecordsWhereAll", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends a conjunction filter with every field", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "rec1", fields: { user_id: "u1", language_profile_id: "p1" } }]));
    const { TeableClient } = await import("../../lib/teable/client");
    const client = new TeableClient();

    const records = await client.listRecordsWhereAll("words", [
      { field: "user_id", value: "u1" },
      { field: "language_profile_id", value: "p1" }
    ]);

    expect(records).toHaveLength(1);
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('"conjunction":"and"');
    expect(url).toContain('"fieldId":"language_profile_id"');
  });

  it("falls back to client-side filtering when the server ignores the filter", async () => {
    // Servidor ignora o filtro e devolve linhas de outro usuário (comportamento
    // do Teable self-hosted v1.10.x); o client deve filtrar no lado de cá.
    fetchMock.mockResolvedValue(jsonResponse([
      { id: "rec1", fields: { user_id: "u1", language_profile_id: "p1" } },
      { id: "rec2", fields: { user_id: "u2", language_profile_id: "p2" } }
    ]));
    const { TeableClient } = await import("../../lib/teable/client");
    const client = new TeableClient();

    const records = await client.listRecordsWhereAll("words", [
      { field: "user_id", value: "u1" },
      { field: "language_profile_id", value: "p1" }
    ]);

    expect(records.map((record) => record.id)).toEqual(["rec1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/teable-client.test.ts`
Expected: FAIL — `client.listRecordsWhereAll is not a function`.

- [ ] **Step 3: Implement `listRecordsWhereAll` in the client**

Em `lib/teable/client.ts`, substituir o método `listRecordsWhere` (linhas 194-223) por:

```ts
  async listRecordsWhere<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    field: string,
    value: string
  ) {
    return this.listRecordsWhereAll<TFields>(tableKey, [{ field, value }]);
  }

  async listRecordsWhereAll<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    filters: Array<{ field: string; value: string }>
  ) {
    const tableId = this.tableId(tableKey);
    const filter = encodeURIComponent(
      JSON.stringify({
        conjunction: "and",
        filterSet: filters.map(({ field, value }) => ({ fieldId: field, operator: "is", value }))
      })
    );
    const matches = (record: TeableRecord<TFields>) =>
      filters.every(({ field, value }) => String(record.fields?.[field] ?? "") === value);
    const records: TeableRecord<TFields>[] = [];
    const pageSize = 1000;

    for (let skip = 0; ; skip += pageSize) {
      const result = await this.request<TeableListResponse<TFields>>(
        `/api/table/${encodeURIComponent(tableId)}/record?take=${pageSize}&skip=${skip}&fieldKeyType=name&filter=${filter}`
      );
      const page = result.records ?? result.data?.records ?? [];

      // Self-hosted Teable (teableio/teable#3041, v1.10.x) can silently ignore
      // the filter param and return unfiltered rows. Detect that and fall back
      // to a full client-side filter so results stay correct on any version.
      if (page.some((record) => !matches(record))) {
        const all = await this.listAllRecords<TFields>(tableKey);
        return all.filter(matches);
      }

      records.push(...page);
      if (page.length < pageSize) return records;
    }
  }
```

- [ ] **Step 4: Run client tests to verify they pass**

Run: `npx vitest run tests/unit/teable-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the Teable mock in vocabulary-selection tests + add failing scoping test**

Em `tests/unit/vocabulary-selection.test.ts`:

1. Adicionar às declarações de mock (perto da linha 55-58):

```ts
const users: Array<{ id: string; fields: Record<string, unknown> }> = [
  { id: "user-1", fields: { timezone: "UTC" } }
];
const listRecordsWhere = vi.fn();
const listRecordsWhereAll = vi.fn();
const getRecord = vi.fn();
```

2. Substituir o mock de `../../lib/teable/client` (linhas 86-89) por:

```ts
vi.mock("../../lib/teable/client", () => ({
  TeableRequestError: class TeableRequestError extends Error {},
  getTeableClient: () => ({
    listRecords,
    listAllRecords: listRecords,
    listRecordsWhere,
    listRecordsWhereAll,
    getRecord,
    createRecord,
    updateRecord
  })
}));
```

3. No `beforeEach`, adicionar as implementações (após o `listRecords.mockImplementation` existente):

```ts
    const tableRecords = (table: string) =>
      table === "words" ? words : table === "wordSenses" ? senses : table === "wordUsageSummaries" ? usageSummaries : users;
    listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
      tableRecords(table).filter((record) => String(record.fields[field] ?? "") === value)
    );
    listRecordsWhereAll.mockImplementation(async (table: string, filters: Array<{ field: string; value: string }>) =>
      tableRecords(table).filter((record) => filters.every(({ field, value }) => String(record.fields[field] ?? "") === value))
    );
    getRecord.mockImplementation(async (table: string, id: string) => {
      const record = tableRecords(table).find((item) => item.id === id);
      if (!record) throw new Error("not found");
      return record;
    });
```

(O `listRecords.mockImplementation` existente pode ser simplificado para usar `tableRecords`, mas não é obrigatório.)

4. Adicionar o teste de escopo (novo describe, ainda dentro do describe principal):

```ts
  describe("scoped reads", () => {
    it("saves using scoped queries instead of full-table scans", async () => {
      words.push({
        id: "word-other-user",
        fields: {
          user_id: "user-2",
          language_profile_id: "profile-2",
          lemma: "solar",
          display_text: "solar",
          canonical_key: JSON.stringify(["user-2", "profile-2", "solar"]),
          forms_json: "[]",
          translation: "solar",
          total_uses: 9
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-solar", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-scoped", ["user:solar"]);

      expect(result.newWordCount).toBe(1);
      expect(listRecordsWhereAll).toHaveBeenCalled();
      // Sem full-table scan de words nem de wordUsageSummaries no fluxo.
      expect(listRecords.mock.calls.filter(([table]) => table === "words" || table === "wordUsageSummaries")).toHaveLength(0);
      // A palavra de outro usuário não foi tocada.
      expect(words.find((word) => word.id === "word-other-user")?.fields.total_uses).toBe(9);
    });
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts -t "scoped reads"`
Expected: FAIL — `listRecordsWhereAll` nunca é chamado e há chamadas de full scan (`listRecords` com "words"/"wordUsageSummaries"). Os demais testes do arquivo devem continuar PASS (o mock novo é retrocompatível: `listAllRecords` continua existindo).

- [ ] **Step 7: Apply scoped reads in `vocabulary-selection.ts`**

a) `getConversationVocabularyGroups` — substituir (linhas 368-374):

```ts
  const words = await getTeableClient().listAllRecords<WordFields>("words");
  const language = context.profile?.fields.language_code ?? "auto";
  const scope = {
    userId: context.conversation.fields.user_id,
    profileId: context.conversation.fields.language_profile_id
  };
  const scopedWords = words.filter((word) => matchesLearningScope(word.fields, scope));
```

por:

```ts
  const language = context.profile?.fields.language_code ?? "auto";
  const scope = {
    userId: context.conversation.fields.user_id,
    profileId: context.conversation.fields.language_profile_id
  };
  const scopedWords = await getTeableClient().listRecordsWhereAll<WordFields>("words", [
    { field: "user_id", value: scope.userId },
    { field: "language_profile_id", value: scope.profileId }
  ]);
```

(Se `matchesLearningScope` ficar sem uso neste arquivo após todas as trocas, removê-lo do import — ele ainda é usado em `persistSelectedVocabulary` no matching da família, então provavelmente permanece.)

b) `persistSelectedVocabulary` — substituir o bloco de leituras (linhas 500-511):

```ts
  const client = getTeableClient();
  const [existingWords, usageSummaries, users] = await Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries"),
    client.listAllRecords<UserFields>("users")
  ]);
  const timeZone = users.find((record) => record.id === context.conversation.fields.user_id)?.fields.timezone ?? "UTC";
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const scope = { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id };
  const scopedWords = existingWords.filter((word) => matchesLearningScope(word.fields, scope));
  const sensesByWord = await listSensesByWordIds(scopedWords.map((word) => word.id));
```

por:

```ts
  const client = getTeableClient();
  const scope = { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id };
  const scopeFilters = [
    { field: "user_id", value: scope.userId },
    { field: "language_profile_id", value: scope.profileId }
  ];
  const [existingWords, usageSummaries, userRecord] = await Promise.all([
    client.listRecordsWhereAll<WordFields>("words", scopeFilters),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", conversationId),
    client.getRecord<UserFields>("users", scope.userId).catch(() => undefined)
  ]);
  const timeZone = userRecord?.fields.timezone ?? "UTC";
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const scopedWords = existingWords;
  const sensesByWord = await listSensesByWordIds(scopedWords.map((word) => word.id));
```

c) Fallback de conflito na criação da palavra (linha ~579) — trocar:

```ts
        const refreshed = await client.listAllRecords<WordFields>("words");
```

por:

```ts
        const refreshed = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
```

d) `otherUses` (linhas 588-591) — trocar:

```ts
    const otherUses = usageSummaries.filter((summary) => summary.fields.word_id === resolvedWord.id && summary.fields.usage_key !== usageKey)
      .reduce((sum, summary) => sum + Number(summary.fields.correct_use_count ?? 0), 0);
```

por (a query de `usageSummaries` agora vem só da conversa atual; os usos de outras conversas desta palavra vêm de uma query filtrada por `word_id`):

```ts
    const wordSummaries = await client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "word_id", resolvedWord.id);
    const otherUses = wordSummaries
      .filter((summary) => summary.fields.usage_key !== usageKey)
      .reduce((sum, summary) => sum + Number(summary.fields.correct_use_count ?? 0), 0);
```

e) Fallback de conflito em `upsertWordUsageSummary` (linha ~708) — trocar:

```ts
    const refreshed = await client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries");
```

por:

```ts
    const refreshed = await client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "usage_key", fields.usage_key);
```

- [ ] **Step 8: Apply scoped reads in `feedback.ts`**

a) `finalizeConversation` (linhas 84-88) — trocar:

```ts
  const supportingData = Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 300)
  ]);
```

por:

```ts
  const supportingData = Promise.all([
    client.listRecordsWhereAll<WordFields>("words", [
      { field: "user_id", value: context.conversation.fields.user_id },
      { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
    ]),
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecords<ConversationFields>("conversations", 300)
  ]);
```

b) `getPersistedCompletion` (linhas 152-156) — trocar:

```ts
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries"),
    client.listAllRecords<WordFields>("words")
  ]);
```

por:

```ts
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", context.conversation.id),
    client.listRecordsWhereAll<WordFields>("words", [
      { field: "user_id", value: context.conversation.fields.user_id },
      { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
    ])
  ]);
```

c) `getConversationSummary` (linhas 199-203) — trocar:

```ts
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listAllRecords<DailyFeedbackFields>("dailyFeedbacks"),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries"),
    client.listAllRecords<WordFields>("words")
  ]);
```

por:

```ts
  const summaryScopeFilters = [
    { field: "user_id", value: context.conversation.fields.user_id },
    { field: "language_profile_id", value: context.conversation.fields.language_profile_id }
  ];
  const [dailyFeedbacks, usageSummaries, words] = await Promise.all([
    client.listRecordsWhereAll<DailyFeedbackFields>("dailyFeedbacks", summaryScopeFilters),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", context.conversation.id),
    client.listRecordsWhereAll<WordFields>("words", summaryScopeFilters)
  ]);
```

(Os filtros por usuário/perfil/data já existentes no código consumidor permanecem — são no-ops sobre o resultado já filtrado.)

- [ ] **Step 9: Run all unit tests**

Run: `npm run test:unit`
Expected: PASS. Se algum outro teste mockar `getTeableClient` sem os métodos novos (procurar por `listAllRecords` em `tests/unit/`), adicionar `listRecordsWhere`/`listRecordsWhereAll`/`getRecord` ao mock afetado seguindo o padrão do Step 5.

- [ ] **Step 10: Typecheck, lint e commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/teable/client.ts lib/learning/vocabulary-selection.ts lib/learning/feedback.ts tests/unit/teable-client.test.ts tests/unit/vocabulary-selection.test.ts
git commit -m "perf: replace full-table scans with scoped queries in vocabulary save and summary"
```

---

### Task 3: `wordSenses` sem full-scan, `nextSenseOrder` em memória e gravações paralelas

Três mudanças de performance: (1) `listSensesByWordIds` deixa de fazer full-table scan e passa a buscar sentidos por `word_id` com concorrência limitada; (2) o save deixa de re-ler `wordSenses` a cada sentido novo (`nextSenseOrderFromList` puro); (3) as gravações independentes de cada família (criação de sentido + upsert do usage summary) rodam em paralelo.

**Files:**
- Modify: `lib/learning/word-senses.ts` (`listSensesByWordIds`, `nextSenseOrderFromList`, helper `mapWithConcurrency`)
- Modify: `lib/learning/vocabulary-selection.ts` (import + corpo do loop de famílias ~linhas 597-679)
- Test: `tests/unit/word-senses.test.ts`
- Test: `tests/unit/vocabulary-selection.test.ts`

**Interfaces:**
- Consumes: `listRecordsWhereAll`/`listRecordsWhere` do client (Task 2); mock atualizado (Task 2).
- Produces: `nextSenseOrderFromList(senses: Array<{ fields: Pick<WordSenseFields, "sense_order"> }>): number` — exportada de `lib/learning/word-senses.ts`.

- [ ] **Step 1: Write the failing tests**

a) Em `tests/unit/word-senses.test.ts`, adicionar (seguindo o estilo de imports do arquivo):

```ts
  it("computes the next sense_order from an in-memory list", async () => {
    const { nextSenseOrderFromList } = await import("../../lib/learning/word-senses");

    expect(nextSenseOrderFromList([])).toBe(1);
    expect(nextSenseOrderFromList([{ fields: { sense_order: 1 } }, { fields: { sense_order: 3 } }])).toBe(4);
    expect(nextSenseOrderFromList([{ fields: {} }])).toBe(1);
  });
```

b) Em `tests/unit/vocabulary-selection.test.ts`, dentro do describe "scoped reads" (Task 2), adicionar:

```ts
    it("never full-scans wordSenses, even when creating a new sense", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 2
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "margem", part_of_speech: "noun", isNewSense: true }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "The bank of the river")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-new-sense-no-scan", ["user:bank"]);

      expect(listRecords.mock.calls.filter(([table]) => table === "wordSenses")).toHaveLength(0);
      const created = senses.find((sense) => sense.fields.translation === "margem");
      expect(created?.fields.sense_order).toBe(2);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/word-senses.test.ts tests/unit/vocabulary-selection.test.ts -t "sense"`
Expected: FAIL — `nextSenseOrderFromList` não existe; o fluxo atual faz full-scan de `wordSenses` via `listSensesByWordIds`/`nextSenseOrder`.

- [ ] **Step 3: Rewrite `listSensesByWordIds` and `nextSenseOrder` in `word-senses.ts`**

Substituir `listSensesByWordIds` (linhas 121-145) e `nextSenseOrder` (linhas 159-163) por:

```ts
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    })
  );
  return results;
}

const SENSE_LOOKUP_CONCURRENCY = 8;

export async function listSensesByWordIds(wordIds: string[]): Promise<Map<string, TeableRecord<WordSenseFields>[]>> {
  const byWord = new Map<string, TeableRecord<WordSenseFields>[]>();
  if (!wordIds.length) return byWord;
  const client = getTeableClient();
  // Deploy-ordering guard: se a tabela ainda não existe neste ambiente, degrada
  // para "sem sentidos" (caminho legado) em vez de 503 — mesmo comportamento de
  // antes, agora detectado na primeira query filtrada.
  let unconfigured = false;
  const groups = await mapWithConcurrency(wordIds, SENSE_LOOKUP_CONCURRENCY, async (wordId) => {
    if (unconfigured) return [] as TeableRecord<WordSenseFields>[];
    try {
      return await client.listRecordsWhere<WordSenseFields>("wordSenses", "word_id", wordId);
    } catch (error) {
      if (!isUnconfiguredWordSensesTableError(error)) throw error;
      unconfigured = true;
      console.warn(`[word-senses] ${WORD_SENSES_ENV_NAME} is not configured; treating every word as sense-less (legacy path).`);
      return [] as TeableRecord<WordSenseFields>[];
    }
  });
  wordIds.forEach((wordId, index) => {
    if (groups[index].length) byWord.set(wordId, groups[index]);
  });
  return byWord;
}
```

```ts
/** Próximo sense_order a partir de sentidos já carregados (sem nova leitura). */
export function nextSenseOrderFromList(senses: Array<{ fields: Pick<WordSenseFields, "sense_order"> }>): number {
  return senses.reduce((order, sense) => Math.max(order, Number(sense.fields.sense_order ?? 0) || 0), 0) + 1;
}

/** Próximo sense_order da palavra (maior existente + 1; 1 quando não há sentidos). */
export async function nextSenseOrder(wordId: string): Promise<number> {
  const senses = (await listSensesByWordIds([wordId])).get(wordId) ?? [];
  return nextSenseOrderFromList(senses);
}
```

Nota: `findSenseByKey` (linhas 147-150) mantém o full-table scan de propósito (fallback raro de conflito por `sense_key`); não faz parte do caminho quente.

- [ ] **Step 4: Parallelize the per-family writes in `vocabulary-selection.ts`**

Adicionar `nextSenseOrderFromList` ao import de `./word-senses` (linhas 10-18).

Substituir o trecho do loop que vai do `updateRecord` da palavra até o upsert do summary (linhas 597-676 aproximadas — do `word = await client.updateRecord<WordFields>("words", resolvedWord.id, {` até `if (!existingUsage) usageSummaries.push(persisted);`) por:

```ts
    const wordUpdate: Partial<WordFields> = {
      forms_json: JSON.stringify(mergedForms),
      total_uses: otherUses + correctUseCount,
      last_used_at: correctUseCount > 0 ? now : resolvedWord.fields.last_used_at,
      ...(!resolvedWord.fields.translation && family.translation ? { translation: family.translation } : {}),
      ...(!resolvedWord.fields.part_of_speech && family.partOfSpeech ? { part_of_speech: family.partOfSpeech } : {}),
      ...(implicitReview ? { ...reviewToWordFields(implicitReview), implicit_review_at: now } : {})
    };
    // Captura de sentidos: palavra nova ganha o sentido primário; palavra
    // existente com significado novo ganha um sentido não-primário, sem tocar
    // em words.translation (cache do primário).
    const filledTranslation = !translationBeforeSave && family.translation ? family.translation.trim() : "";
    const senseBase = {
      word_id: resolvedWord.id,
      part_of_speech: family.partOfSpeech,
      example_sentence: relevant[0]?.context ?? "",
      source: "chat" as const,
      review_due_at: reviewDue,
      review_state: "new" as const,
      created_at: now
    };
    let senseToCreate: WordSenseFields | null = null;
    if (createdWord) {
      senseToCreate = {
        ...senseBase,
        sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation),
        translation: family.translation,
        is_primary: true,
        sense_order: 1
      };
    } else if (!wordSenses.length && filledTranslation) {
      // Buraco do backfill: a palavra não tinha sentido nem tradução; a
      // tradução que acabou de preencher words.translation vira o primário.
      senseToCreate = {
        ...senseBase,
        sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, filledTranslation),
        translation: filledTranslation,
        is_primary: true,
        sense_order: 1
      };
    } else if (family.translation && family.candidateIds.some((id) => linguisticData[id]?.isNewSense)) {
      const senseKey = canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation);
      // Dedupe por sense_key/tradução normalizada: falso positivo da IA vira
      // known_sense mesmo que a análise diga new_sense.
      const alreadyKnown = wordSenses.some((sense) =>
        matchesCanonicalSenseKey(sense.fields.sense_key, senseKey) ||
        normalizeVocabularyToken(sense.fields.translation ?? "") === normalizeVocabularyToken(family.translation)
      );
      if (!alreadyKnown) {
        senseToCreate = {
          ...senseBase,
          sense_key: senseKey,
          translation: family.translation,
          is_primary: false,
          sense_order: nextSenseOrderFromList(wordSenses)
        };
      }
    }
    const summaryFields: WordUsageSummaryFields = {
      Name: forms[0] ?? family.lemma,
      usage_key: usageKey,
      word_id: resolvedWord.id,
      conversation_id: conversationId,
      forms_json: JSON.stringify(forms),
      observed_count: relevant.length,
      correct_use_count: correctUseCount,
      correction_count: familyCandidates.reduce((sum, candidate) => sum + candidate.incorrectOccurrenceCount, 0),
      first_used_at: existingUsage?.fields.first_used_at || now,
      last_used_at: now
    };
    word = await client.updateRecord<WordFields>("words", resolvedWord.id, wordUpdate);
    // Gravações independentes da família em paralelo: o sentido novo e o resumo
    // de uso não dependem um do outro.
    const [createdSense, persisted] = await Promise.all([
      senseToCreate ? createWordSense(senseToCreate) : Promise.resolve(null),
      upsertWordUsageSummary(client, usageSummaries, existingUsage, summaryFields)
    ]);
    if (createdSense) {
      const allSenses = [...wordSenses, createdSense];
      sensesByWord.set(resolvedWord.id, allSenses);
      // O cache da word reflete o agregado dos sentidos (a tradução do
      // primário não muda). Sem sentidos pré-existentes não há o que agregar.
      if (wordSenses.length) {
        await client.updateRecord<WordFields>("words", resolvedWord.id, aggregateSenseReviewToWordFields(allSenses));
      }
    }
    if (!existingUsage) usageSummaries.push(persisted);
```

Verificar que os trechos removidos (antigas linhas 597-676) não deixem restos duplicados de `summaryFields`, `senseBase`, `filledTranslation` ou da variável `persisted` — o bloco acima os substitui por completo. Variáveis calculadas antes desse trecho (`resolvedWord`, `wordSenses`, `translationBeforeSave`, `usageKey`, `existingUsage`, `previousObservedCount`, `wordSummaries`/`otherUses`, `mergedForms`, `dueTime`, `implicitReview`, `forms`, `correctUseCount`) permanecem inalteradas.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (incluindo os novos testes e toda a suíte de vocabulary/word-senses).

- [ ] **Step 6: Typecheck, lint e commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add lib/learning/word-senses.ts lib/learning/vocabulary-selection.ts tests/unit/word-senses.test.ts tests/unit/vocabulary-selection.test.ts
git commit -m "perf: drop wordSenses full-scans and parallelize per-family vocabulary writes"
```

---

### Task 4: `total_uses` por sentido

Novo campo `total_uses` (number) na tabela `wordSenses`: sentidos criados no chat nascem com o número de usos corretos da sessão; sentido existente reutilizado é incrementado. Falha no incremento não aborta o salvamento.

**Files:**
- Modify: `lib/teable/schema.ts` (tabela `wordSenses`, ~linha 216)
- Modify: `lib/learning/conversations.ts` (`WordSenseFields`, ~linha 101)
- Modify: `lib/learning/vocabulary-selection.ts` (import de `updateWordSense` + 3 branches de `senseToCreate` + bloco de incremento)
- Create: `scripts/ensure-word-senses-usage-fields.mjs`
- Modify: `package.json` (script `senses:usage-fields`)
- Test: `tests/unit/vocabulary-selection.test.ts`

**Interfaces:**
- Consumes: `senseToCreate`/`createdSense`/`wordSenses` da reestruturação da Task 3; `updateWordSense(senseId: string, fields: Partial<WordSenseFields>)` já existe em `lib/learning/word-senses.ts:180`.
- Produces: `WordSenseFields.total_uses?: number` — consumido pela Task 5 (UI).

- [ ] **Step 1: Write the failing tests**

Em `tests/unit/vocabulary-selection.test.ts`, novo describe:

```ts
  describe("per-sense usage counting", () => {
    it("creates the primary sense of a new word already carrying the session usage count", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-1", "user", "Solar panels"), buildMessage("m-2", "user", "Solar energy")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-sense-count-new", ["user:solar"]);

      expect(senses).toHaveLength(1);
      expect(senses[0].fields.total_uses).toBe(2);
    });

    it("increments the matching existing sense instead of creating a duplicate", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 3
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1,
          total_uses: 3
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "I went to the bank")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-sense-count-existing", ["user:bank"]);

      expect(senses).toHaveLength(1);
      expect(senses[0].fields.total_uses).toBe(4);
    });

    it("still saves the word when the sense usage increment fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 1
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1,
          total_uses: 1
        }
      });
      updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
        if (table === "wordSenses") throw new Error("teable down");
        const record = words.find((item) => item.id === id)!;
        record.fields = { ...record.fields, ...fields };
        return record;
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "I went to the bank")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-sense-count-failure", ["user:bank"]);

      expect(result.updatedWordCount).toBe(1);
      expect(warn).toHaveBeenCalled();
    });
  });
```

Nota: o mock de `updateRecord` deste último teste precisa ser restaurado ao padrão — o `beforeEach` já reatribui `updateRecord.mockImplementation` a cada teste, então basta este teste estar dentro do describe principal (que tem o `beforeEach`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts -t "per-sense usage counting"`
Expected: FAIL — `total_uses` nunca é escrito; o teste de falha do incremento propaga o erro (ou não incrementa).

- [ ] **Step 3: Add the field to schema, types and ensure script**

a) `lib/teable/schema.ts`, tabela `wordSenses`, após o campo `sense_order`:

```ts
      { name: "total_uses", type: "number", note: "Correct conversation uses attributed to this sense." },
```

b) `lib/learning/conversations.ts`, tipo `WordSenseFields`, após `sense_order?: number;`:

```ts
  total_uses?: number;
```

c) Criar `scripts/ensure-word-senses-usage-fields.mjs`:

```js
import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const FIELD_PLAN = [
  {
    envName: "TEABLE_WORD_SENSES_TABLE_ID",
    fields: [
      { type: "number", name: "total_uses", description: "Correct conversation uses attributed to this sense." }
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

d) `package.json`, após `"senses:flashcard-fields"`:

```json
    "senses:usage-fields": "node scripts/ensure-word-senses-usage-fields.mjs",
```

- [ ] **Step 4: Count usages per sense in the save flow**

Em `lib/learning/vocabulary-selection.ts`:

a) Adicionar `updateWordSense` ao import de `./word-senses`.

b) Nos três branches de `senseToCreate` (Task 3), adicionar `total_uses: correctUseCount` ao objeto criado — ex.: o branch `createdWord` fica:

```ts
      senseToCreate = {
        ...senseBase,
        sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation),
        translation: family.translation,
        is_primary: true,
        sense_order: 1,
        total_uses: correctUseCount
      };
```

(os outros dois branches — buraco do backfill e novo sentido de palavra existente — recebem a mesma linha `total_uses: correctUseCount`.)

c) Logo após o bloco `if (createdSense) { ... }`, adicionar:

```ts
    // Sentido existente reutilizado: incrementa o contador do sentido cuja
    // tradução corresponde à usada. Palavras legadas sem sentidos não têm onde
    // contar (seguem só com words.total_uses). Falha aqui não aborta o save.
    if (!createdSense && correctUseCount > 0 && family.translation) {
      const familySenseKey = canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation);
      const matched = wordSenses.find((sense) =>
        matchesCanonicalSenseKey(sense.fields.sense_key, familySenseKey) ||
        normalizeVocabularyToken(sense.fields.translation ?? "") === normalizeVocabularyToken(family.translation)
      );
      if (matched) {
        try {
          const updated = await updateWordSense(matched.id, { total_uses: Number(matched.fields.total_uses ?? 0) + correctUseCount });
          Object.assign(matched, updated);
        } catch (error) {
          console.warn(`sense total_uses increment failed for sense ${matched.id}`, error);
        }
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/vocabulary-selection.test.ts`
Expected: PASS.

- [ ] **Step 6: Apply the field in QA and dev**

Run (dry-run primeiro, depois apply):
```bash
node scripts/ensure-word-senses-usage-fields.mjs --env .env.qa.local
node scripts/ensure-word-senses-usage-fields.mjs --env .env.qa.local --apply
node scripts/ensure-word-senses-usage-fields.mjs
node scripts/ensure-word-senses-usage-fields.mjs --apply
```
Expected: `"fieldExists": true` nos dois ambientes. (Produção: documentar no passo de deploy — ver `docs/DEPLOYMENT.md` — e aplicar com o env de prod antes de publicar.)

- [ ] **Step 7: Typecheck, lint, full suite e commit**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: PASS.

```bash
git add lib/teable/schema.ts lib/learning/conversations.ts lib/learning/vocabulary-selection.ts scripts/ensure-word-senses-usage-fields.mjs package.json tests/unit/vocabulary-selection.test.ts
git commit -m "feat: track per-sense usage counts on vocabulary save"
```

---

### Task 5: Estatísticas de uso na UI (Resumo + Palavras)

Resumo do chat mostra contador de palavras nunca usadas e usos por sentido nas palavras salvas; página Palavras ganha o bucket "não usadas" e o detalhe da palavra mostra "usos" por sentido.

**Files:**
- Modify: `lib/learning/feedback.ts` (`getConversationSummary`: `wordSensesUsage` + `unusedWordCount` no retorno)
- Modify: `lib/learning/vocabulary-picker-ui.ts` (`formatSavedWordMeta` + tipo `SavedWordSenseUsage`)
- Modify: `app/resumo/page.tsx` (4ª métrica + meta por sentido)
- Modify: `lib/learning/words.ts` (`summary.unusedWords`, `WordSenseListItem.totalUses`)
- Modify: `app/palavras/page.tsx` (bucket "não usadas")
- Modify: `components/WordSensesSection.tsx` (linha de usos por sentido)
- Test: `tests/unit/vocabulary-picker-ui.test.ts` (novo)

**Interfaces:**
- Consumes: `WordSenseFields.total_uses` (Task 4); `listSensesByWordIds` (Task 3).
- Produces:
  - `SavedWordSenseUsage = { wordId: string; translation: string; isPrimary: boolean; totalUses: number }`
  - `formatSavedWordMeta(word: { id: string; fields: { translation?: string; total_uses?: number } }, senses: SavedWordSenseUsage[]): string`
  - `getConversationSummary` retorna também `wordSensesUsage: SavedWordSenseUsage[]` e `unusedWordCount: number`.
  - `WordSenseListItem.totalUses: number`; `getWordsData().summary.unusedWords: number`.

- [ ] **Step 1: Write the failing tests**

Criar `tests/unit/vocabulary-picker-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSavedWordMeta } from "../../lib/learning/vocabulary-picker-ui";

describe("formatSavedWordMeta", () => {
  it("shows per-sense usage counts when the word has senses", () => {
    const meta = formatSavedWordMeta(
      { id: "word-1", fields: { translation: "banco", total_uses: 5 } },
      [
        { wordId: "word-1", translation: "banco", isPrimary: true, totalUses: 4 },
        { wordId: "word-1", translation: "margem", isPrimary: false, totalUses: 1 }
      ]
    );

    expect(meta).toBe("banco · usada 4x · margem · usada 1x");
  });

  it("falls back to the word translation when there are no senses", () => {
    expect(formatSavedWordMeta({ id: "word-1", fields: { translation: "casa", total_uses: 2 } }, [])).toBe("casa");
  });

  it("falls back to the word-level usage count without translation or senses", () => {
    expect(formatSavedWordMeta({ id: "word-1", fields: { translation: "", total_uses: 3 } }, [])).toBe("usada 3 vez(es)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/vocabulary-picker-ui.test.ts`
Expected: FAIL — `formatSavedWordMeta is not a function`.

- [ ] **Step 3: Implement `formatSavedWordMeta`**

Em `lib/learning/vocabulary-picker-ui.ts`, adicionar:

```ts
export type SavedWordSenseUsage = {
  wordId: string;
  translation: string;
  isPrimary: boolean;
  totalUses: number;
};

/** Meta da linha "Já salvas desta conversa": usos por sentido quando existem. */
export function formatSavedWordMeta(
  word: { id: string; fields: { translation?: string; total_uses?: number } },
  senses: SavedWordSenseUsage[]
) {
  const own = senses.filter((sense) => sense.wordId === word.id);
  if (!own.length) return word.fields.translation || `usada ${Number(word.fields.total_uses ?? 0)} vez(es)`;
  return own.map((sense) => `${sense.translation || "sem tradução"} · usada ${sense.totalUses}x`).join(" · ");
}
```

- [ ] **Step 4: Extend `getConversationSummary` in `feedback.ts`**

Adicionar ao topo: `import { listSensesByWordIds } from "./word-senses";`

Importante: a página de resumo pode ser servida do `completionCache` (30 s após finalizar a conversa — o caminho comum), e o valor cacheado vem de `buildCompletionSummary`, que é síncrono e não conhece os campos novos. Por isso os campos são computados num wrapper aplicado AOS DOIS caminhos (cache e leitura fresca), sem mexer em `buildCompletionSummary`.

a) Em `getConversationSummary`, trocar o early-return do cache (linhas 186-190):

```ts
  const cached = completionCache.get(conversationId);
  if (cached) {
    completionCache.delete(conversationId);
    if (cached.expiresAt > Date.now()) return cached.value;
  }
```

por:

```ts
  const cached = completionCache.get(conversationId);
  if (cached) {
    completionCache.delete(conversationId);
    if (cached.expiresAt > Date.now()) return withVocabularyUsageStats(cached.value);
  }
```

b) Substituir o `return` final (linhas 237-245):

```ts
  return {
    ...context,
    dailyFeedback: dailyFeedback!,
    words: conversationWords,
    vocabularyWords: words.filter((word) => matchesLearningScope(word.fields, {
      userId: context.conversation.fields.user_id,
      profileId: context.conversation.fields.language_profile_id
    }))
  };
```

por:

```ts
  return withVocabularyUsageStats({
    ...context,
    dailyFeedback: dailyFeedback!,
    words: conversationWords,
    vocabularyWords: words.filter((word) => matchesLearningScope(word.fields, {
      userId: context.conversation.fields.user_id,
      profileId: context.conversation.fields.language_profile_id
    }))
  });
```

c) Adicionar o wrapper logo após `getConversationSummary`:

```ts
/**
 * Acrescenta usos por sentido das palavras da conversa e o contador de
 * palavras do banco nunca usadas. Roda sobre o resumo fresco e sobre o valor
 * do completionCache (que não carrega esses campos).
 */
async function withVocabularyUsageStats<T extends { words: TeableRecord<WordFields>[]; vocabularyWords: TeableRecord<WordFields>[] }>(summary: T) {
  const sensesByWord = await listSensesByWordIds(summary.words.map((word) => word.id));
  return {
    ...summary,
    wordSensesUsage: summary.words.flatMap((word) =>
      (sensesByWord.get(word.id) ?? []).map((sense) => ({
        wordId: word.id,
        translation: sense.fields.translation ?? "",
        isPrimary: sense.fields.is_primary === true,
        totalUses: Number(sense.fields.total_uses ?? 0)
      }))
    ),
    unusedWordCount: summary.vocabularyWords.filter((word) => Number(word.fields.total_uses ?? 0) === 0).length
  };
}
```

- [ ] **Step 5: Update the Resumo page**

Em `app/resumo/page.tsx`:

a) Imports: adicionar `BookOpen` ao import de `lucide-react` e `import { formatSavedWordMeta } from "@/lib/learning/vocabulary-picker-ui";`.

b) Adicionar a 4ª métrica ao array `metrics`:

```ts
    {
      value: String(data.unusedWordCount),
      label: "Nunca usadas",
      icon: BookOpen,
      tone: "info" as const
    }
```

c) Na seção "Já salvas desta conversa", trocar o `meta`:

```tsx
                meta={formatSavedWordMeta(word, data.wordSensesUsage)}
```

- [ ] **Step 6: Update Palavras (summary + detail)**

a) `lib/learning/words.ts`:
   - Em `getWordsData`, adicionar ao objeto `summary`:
     ```ts
     unusedWords: mapped.filter((word) => word.totalUses === 0).length,
     ```
   - No tipo `WordSenseListItem`, adicionar `totalUses: number;`.
   - Em `toWordSenseListItem`, adicionar ao retorno: `totalUses: Number(sense.fields.total_uses ?? 0),`.
   - Em `legacyWordSenseListItem`, adicionar ao retorno: `totalUses: word.totalUses,`.

b) `app/palavras/page.tsx`, seção `word-review-states` — adicionar um bucket:

```tsx
<div><strong>{data.summary.unusedWords}</strong><span>não usadas</span></div>
```

c) `components/WordSensesSection.tsx`, linha de meta do sentido — trocar:

```tsx
            <p className="row-meta">{sense.reviewStreak} {sense.reviewStreak === 1 ? "acerto seguido" : "acertos seguidos"} · {sense.lapseCount} {sense.lapseCount === 1 ? "lapso" : "lapsos"}</p>
```

por:

```tsx
            <p className="row-meta">{sense.totalUses} {sense.totalUses === 1 ? "uso" : "usos"} · {sense.reviewStreak} {sense.reviewStreak === 1 ? "acerto seguido" : "acertos seguidos"} · {sense.lapseCount} {sense.lapseCount === 1 ? "lapso" : "lapsos"}</p>
```

- [ ] **Step 7: Run all checks**

Run: `npx vitest run tests/unit/vocabulary-picker-ui.test.ts && npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS. Atenção a `tests/unit/word-senses-ui.test.ts` / `word-senses-detail.test.ts`: se montarem `WordSenseListItem` literal, adicionar `totalUses` aos fixtures; se assertarem a linha de meta antiga, atualizar a expectativa para incluir "usos".

- [ ] **Step 8: Commit**

```bash
git add lib/learning/feedback.ts lib/learning/vocabulary-picker-ui.ts app/resumo/page.tsx lib/learning/words.ts app/palavras/page.tsx components/WordSensesSection.tsx tests/unit/vocabulary-picker-ui.test.ts
git commit -m "feat: show unused-word count and per-sense usage in summary and words screens"
```

---

## Deploy notes (fora do código)

1. Antes do deploy em produção: `node scripts/ensure-word-senses-usage-fields.mjs --env <env-de-prod> --apply` e atualizar `docs/DEPLOYMENT.md` com o novo campo (seguindo o padrão do rollout de `TEABLE_WORD_SENSES_TABLE_ID`).
2. Sentidos pré-existentes ficam com `total_uses` vazio (= 0) — comportamento intencional, sem backfill.
