# Melhorias de Perfil, Palavras e Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatro melhorias aprovadas no spec `docs/superpowers/specs/2026-08-14-profile-words-chat-improvements-design.md`: botão Logout no padrão do app, paginação + filtros rápidos em Palavras, timer do chat que pausa fora da aba com descarte automático de treino abandonado, e remoção da UI de "Ouvir respostas da IA" e Conexões no perfil.

**Architecture:** Next.js 15 App Router com server components e fachada de dados `getTeableClient()` (Supabase + RLS). Mudanças concentradas em componentes existentes; lógica pura nova vai para módulos pequenos em `lib/learning/` testáveis com vitest.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase (via fachada Teable), vitest (`npm run test:unit`), ESLint (`npm run lint`).

## Global Constraints

- Backend de dados: sempre via `getTeableClient()` de `@/lib/supabase/client`; não adicionar novas dependências.
- UI: classes globais chunky de `app/globals.css` (`outline-button`, `green-button`, `full-button`, `pill`); nunca `var(--primary)` em código novo; textos da UI em pt-BR.
- `reactStrictMode: true` está ativo em `next.config.mjs` — efeitos React montam/desmontam duas vezes em dev; qualquer side effect em cleanup precisa de guarda (ver Task 5).
- Verificação ao final de cada task: `npm run typecheck && npm run lint && npm run test:unit` — tudo verde antes do commit.
- Commits por task, conventional commits curtos (padrão do repo, ex.: `feat: ...`, `fix: ...`).
- O timer do chat só existe em treino ativo (`readOnly=false`); nenhuma mudança de comportamento em visualização de histórico.

---

### Task 1: Botão Logout no padrão chunky do app

**Files:**
- Modify: `components/LogoutButton.tsx`
- Also commit: `docs/superpowers/plans/2026-08-14-profile-words-chat-improvements.md` (este plano) e a revisão da seção 2 de `docs/superpowers/specs/2026-08-14-profile-words-chat-improvements-design.md`

**Interfaces:**
- Consumes: `logout` server action de `@/app/login/actions` (inalterada); classes `outline-button full-button` de `app/globals.css`.
- Produces: nada consumido por outras tasks.

Mudança puramente visual (texto + classes CSS); não há unidade lógica para teste unitário — a verificação é typecheck/lint e revisão visual no passo manual.

- [ ] **Step 1: Reescrever o botão**

Substituir todo o conteúdo de `components/LogoutButton.tsx` por:

```tsx
"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  return (
    <button type="button" onClick={() => logout()} className="outline-button full-button">
      <LogOut size={18} />
      Logout
    </button>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS (sem erros)

- [ ] **Step 3: Commit**

```bash
git add components/LogoutButton.tsx docs/superpowers/plans/2026-08-14-profile-words-chat-improvements.md docs/superpowers/specs/2026-08-14-profile-words-chat-improvements-design.md
git commit -m "feat: botão Logout no padrão chunky do app + plano de implementação"
```

---

### Task 2: Perfil — remover "Ouvir respostas da IA" e seção Conexões; áudio sempre ligado

**Files:**
- Modify: `components/ProfilePreferences.tsx`
- Modify: `app/chat/page.tsx:49`
- Modify: `lib/learning/flashcards.ts:272`
- Modify: `lib/learning/account.ts:76`

**Interfaces:**
- Consumes: `getProfileSettings()` (`lib/learning/account.ts`) continua retornando o mesmo shape; `ChatConversation` prop `audioEnabled: boolean` permanece (componente inalterado nesta task).
- Produces: leituras de `audio_enabled` sempre `true` nos três pontos de leitura; nada consumido por outras tasks.

Contexto: `audioEnabled` é lido em três lugares — `app/chat/page.tsx:49`, `lib/learning/flashcards.ts:272`, `lib/learning/account.ts:76`. O toggle do perfil é o único controle de UI que o altera fora do onboarding; removido o toggle, a leitura passa a ser sempre `true`. O checkbox do onboarding (`components/OnboardingForm.tsx:243`) fica fora de escopo de propósito (decisão do spec) — mas como as leituras passam a ignorar o valor salvo, ele não afeta mais o comportamento.

- [ ] **Step 1: Remover toggle de áudio e seção Conexões do componente**

Em `components/ProfilePreferences.tsx`:

a) Linha 3 — remover os ícones só usados pelas seções removidas:

```ts
import { Check, Download, Loader2, ShieldAlert, Trash2, UserRound } from "lucide-react";
```

b) Linha 4 — remover o import (só `ConnectionLink` usa `Link`):

```ts
// remover: import Link from "next/link";
```

c) Props type (linhas 16-30) — remover `audioEnabled: boolean;` do tipo de `activeProfile` e remover todo o bloco `connections: { ... }`:

```ts
    activeProfile: {
      id: string;
      languageName: string;
      level: string;
      correctionStyle: string;
      transcriptEnabled: boolean;
      calendarMemoryEnabled: boolean;
    } | null;
    languageProfiles: Array<{ id: string; languageName: string; level: string }>;
```

d) Estado `preferences` (linhas 45-51) — remover a linha `audioEnabled: initial.activeProfile?.audioEnabled ?? true,`.

e) Seção "Áudio e aprendizagem" (linha 196) — remover a linha do toggle de áudio, ficando:

```tsx
      <section className="section">
        <h2 className="section-title">Áudio e aprendizagem</h2>
        <div className="settings-card">
          <ToggleRow checked={preferences.transcriptEnabled} label="Mostrar transcrição" onChange={(checked) => savePreference({ transcriptEnabled: checked })} />
          <ToggleRow checked={preferences.calendarMemoryEnabled} label="Usar memória do calendário" onChange={(checked) => savePreference({ calendarMemoryEnabled: checked })} />
        </div>
      </section>
```

f) Remover a seção Conexões inteira (linhas 202-209, o `<section className="section">` com `<h2>Conexões</h2>` e os três `ConnectionLink`).

g) Remover a função `ConnectionLink` (linhas 262-269).

- [ ] **Step 2: Forçar áudio sempre ligado nos pontos de leitura**

a) `app/chat/page.tsx:49` — trocar:

```tsx
        audioEnabled={true}
```

b) `lib/learning/flashcards.ts:272` — trocar a linha por:

```ts
      audioEnabled: true,
```

c) `lib/learning/account.ts:76` — trocar a linha por:

```ts
          audioEnabled: true,
```

- [ ] **Step 3: Rodar a suíte existente**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS. Se algum teste existente falhar por assertar o valor antigo de `audioEnabled` lido do perfil (ex.: fixture com `audio_enabled: false`), ajustar a expectativa do teste para o novo comportamento (sempre `true`) — não reverter a mudança.

- [ ] **Step 4: Commit**

```bash
git add components/ProfilePreferences.tsx app/chat/page.tsx lib/learning/flashcards.ts lib/learning/account.ts
git commit -m "feat: remover toggle de áudio e seção Conexões do perfil; áudio da IA sempre ligado"
```

---

### Task 3: Palavras — paginação + correção de performance dos filtros

**Files:**
- Create: `lib/learning/pagination.ts`
- Test: `tests/unit/words-pagination.test.ts`
- Modify: `lib/learning/words.ts` (`getWordsData` em `:132-182`)
- Modify: `app/palavras/page.tsx`
- Modify: `app/globals.css` (adicionar `.pagination-row`)

**Interfaces:**
- Consumes: estruturas atuais de `lib/learning/words.ts` (`getWordRecords`, `toWordListItem`, `matchesFilter`, `matchesWordSearch`).
- Produces:
  - `paginateSlice<T>(items: T[], requestedPage: number, pageSize?: number): { pageItems: T[]; page: number; totalPages: number; totalItems: number }` e `WORDS_PAGE_SIZE = 20` em `lib/learning/pagination.ts`.
  - `getWordsData(filter?: WordFilter, query?: string, page?: number)` — com `page` definido, retorna `words` fatiado + `page`, `totalPages`, `totalFiltered`; sem `page`, retorna a lista completa (preserva `startWeakWordsPractice`, que chama `getWordsData("all")` e precisa de todas as palavras).

Causa raiz da lentidão (do spec, seção 2 revisada): `toWordListItem` faz `usageSummaries.filter(...)` por palavra — O(n×m). O sumário e a `dailyQueue` precisam do conjunto completo, então a correção é agrupar os summaries uma vez (O(n+m)) e fatiar só a lista renderizada.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/words-pagination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { paginateSlice, WORDS_PAGE_SIZE } from "../../lib/learning/pagination";

describe("paginateSlice", () => {
  const items = Array.from({ length: 45 }, (_, index) => index + 1);

  it("retorna a primeira página com 20 itens", () => {
    const result = paginateSlice(items, 1);
    expect(result.pageItems).toHaveLength(WORDS_PAGE_SIZE);
    expect(result.pageItems[0]).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(45);
  });

  it("retorna a última página parcial", () => {
    expect(paginateSlice(items, 3).pageItems).toEqual([41, 42, 43, 44, 45]);
  });

  it("limita páginas abaixo de 1 e acima do total", () => {
    expect(paginateSlice(items, 0).page).toBe(1);
    expect(paginateSlice(items, 99).page).toBe(3);
    expect(paginateSlice(items, Number.NaN).page).toBe(1);
  });

  it("lida com lista vazia", () => {
    const result = paginateSlice([] as number[], 5);
    expect(result.pageItems).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e vê-lo falhar**

Run: `npx vitest run tests/unit/words-pagination.test.ts`
Expected: FAIL (módulo `../../lib/learning/pagination` não existe)

- [ ] **Step 3: Criar `lib/learning/pagination.ts`**

```ts
export const WORDS_PAGE_SIZE = 20;

export type PaginatedSlice<T> = {
  pageItems: T[];
  page: number;
  totalPages: number;
  totalItems: number;
};

export function paginateSlice<T>(items: T[], requestedPage: number, pageSize: number = WORDS_PAGE_SIZE): PaginatedSlice<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const normalized = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(Math.max(1, normalized), totalPages);
  return {
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
    totalItems
  };
}
```

- [ ] **Step 4: Rodar o teste e vê-lo passar**

Run: `npx vitest run tests/unit/words-pagination.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Corrigir o O(n×m) e paginar em `getWordsData`**

Em `lib/learning/words.ts`:

a) Adicionar o import no topo:

```ts
import { paginateSlice } from "./pagination";
```

b) Mudar a assinatura (linha 132):

```ts
export async function getWordsData(filter: WordFilter = "all", query = "", page?: number) {
```

c) Substituir o mapeamento (linha 147) pelo agrupamento indexado:

```ts
  const summariesByWordId = new Map<string, TeableRecord<WordUsageSummaryFields>[]>();
  for (const summary of records.usageSummaries) {
    const wordId = summary.fields.word_id;
    if (!wordId) continue;
    const list = summariesByWordId.get(wordId);
    if (list) list.push(summary);
    else summariesByWordId.set(wordId, [summary]);
  }
  const mapped = scoped.map((word) => toWordListItem(word, summariesByWordId.get(word.id) ?? [], now));
```

d) Após o cálculo de `visibleWords` (linhas 149-154), fatiar:

```ts
  const pagination = paginateSlice(visibleWords, page ?? 1);
```

e) No retorno (linhas 159-163), trocar `words: visibleWords` e adicionar os metadados de paginação:

```ts
  return {
    filter,
    languageCode: scope.languageCode,
    query: query.trim().slice(0, 80),
    words: page === undefined ? visibleWords : pagination.pageItems,
    page: pagination.page,
    totalPages: pagination.totalPages,
    totalFiltered: pagination.totalItems,
```

(restante do retorno — `dailyQueue`, `summary` — inalterado)

- [ ] **Step 6: UI de paginação em `app/palavras/page.tsx`**

a) `WordsPageProps` (linhas 19-24) — adicionar `page?: string;` ao tipo de `searchParams`.

b) Linha 29 — passar a página:

```ts
  const data = await getWordsData(filter, params?.q ?? "", Number(params?.page ?? "1"));
```

c) `buildWordsHref` (linhas 116-120) — aceitar página opcional:

```ts
function buildWordsHref(filter: string, query: string, page?: number) {
  const params = new URLSearchParams({ filter });
  if (query) params.set("q", query);
  if (page && page > 1) params.set("page", String(page));
  return `/palavras?${params.toString()}`;
}
```

Os links de filtro (linha 76) continuam chamando `buildWordsHref(item, data.query)` — trocar de filtro ou buscar reseta para a página 1, que é o comportamento desejado (o form de busca também não envia `page`).

d) Logo após o fechamento da `<section className="section row-list">` (linha 110) e antes de `<WordPracticeButton />`, adicionar:

```tsx
      {data.totalPages > 1 ? (
        <nav aria-label="Paginação de palavras" className="pagination-row">
          {data.page > 1 ? (
            <Link className="outline-button" href={buildWordsHref(filter, data.query, data.page - 1)}>Anterior</Link>
          ) : <span />}
          <span className="row-meta">Página {data.page} de {data.totalPages}</span>
          {data.page < data.totalPages ? (
            <Link className="outline-button" href={buildWordsHref(filter, data.query, data.page + 1)}>Próxima</Link>
          ) : <span />}
        </nav>
      ) : null}
```

- [ ] **Step 7: Estilo `.pagination-row` em `app/globals.css`**

Adicionar logo após a regra `.full-button` (por volta de `:368-370`):

```css
.pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 20px;
}
```

- [ ] **Step 8: Verificação completa**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/learning/pagination.ts tests/unit/words-pagination.test.ts lib/learning/words.ts app/palavras/page.tsx app/globals.css
git commit -m "feat: paginação em Palavras e correção do mapeamento O(n×m) dos filtros"
```

---

### Task 4: Chat — timer que pausa com a aba em segundo plano

**Files:**
- Create: `lib/learning/chat-elapsed.ts`
- Test: `tests/unit/chat-elapsed.test.ts`
- Test: `tests/unit/conversation-end.test.ts` (estender)
- Modify: `components/ChatConversation.tsx` (`ElapsedTimePill` `:778-792`, `finishConversation` `:303-318`)
- Modify: `app/api/conversations/[conversationId]/end/route.ts`
- Modify: `lib/learning/feedback.ts` (`endConversation` `:60-72`, `finalizeConversation` `:74`, duração em `:107-110`)

**Interfaces:**
- Consumes: `computeElapsedSeconds` local de `ChatConversation.tsx` (será substituído), fluxo atual de `endConversation`.
- Produces:
  - `computeActiveElapsedSeconds(startedAt: string, pausedMs?: number, now?: number): number` em `lib/learning/chat-elapsed.ts`.
  - `clampPausedMs(pausedMs: unknown, startedAt: string, now?: number): number` em `lib/learning/chat-elapsed.ts`.
  - `endConversation(conversationId: string, options?: { pausedMs?: number })` — `options` default `{}`; chamadas existentes sem `options` (Task atual, testes existentes) continuam válidas.
  - `POST /api/conversations/[conversationId]/end` aceita body JSON opcional `{ pausedMs?: number }`; sem body, comportamento atual.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/chat-elapsed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampPausedMs, computeActiveElapsedSeconds } from "../../lib/learning/chat-elapsed";

const startedAt = "2026-08-14T10:00:00.000Z";
const startedMs = new Date(startedAt).getTime();

describe("computeActiveElapsedSeconds", () => {
  it("conta os segundos decorridos sem pausas", () => {
    expect(computeActiveElapsedSeconds(startedAt, 0, startedMs + 65_000)).toBe(65);
  });

  it("desconta o tempo pausado acumulado", () => {
    expect(computeActiveElapsedSeconds(startedAt, 20_000, startedMs + 65_000)).toBe(45);
  });

  it("nunca retorna negativo", () => {
    expect(computeActiveElapsedSeconds(startedAt, 999_999, startedMs + 10_000)).toBe(0);
  });

  it("retorna 0 para data de início inválida", () => {
    expect(computeActiveElapsedSeconds("not-a-date", 0, startedMs)).toBe(0);
  });
});

describe("clampPausedMs", () => {
  it("mantém valores válidos", () => {
    expect(clampPausedMs(30_000, startedAt, startedMs + 60_000)).toBe(30_000);
  });

  it("limita ao tempo total decorrido", () => {
    expect(clampPausedMs(120_000, startedAt, startedMs + 60_000)).toBe(60_000);
  });

  it("rejeita valores inválidos", () => {
    expect(clampPausedMs(-5, startedAt, startedMs + 60_000)).toBe(0);
    expect(clampPausedMs("30000", startedAt, startedMs + 60_000)).toBe(0);
    expect(clampPausedMs(Number.NaN, startedAt, startedMs + 60_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/chat-elapsed.test.ts`
Expected: FAIL (módulo `../../lib/learning/chat-elapsed` não existe)

- [ ] **Step 3: Criar `lib/learning/chat-elapsed.ts`**

```ts
export function computeActiveElapsedSeconds(startedAt: string, pausedMs = 0, now: number = Date.now()) {
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return 0;
  return Math.max(0, Math.floor((now - startedMs - Math.max(0, pausedMs)) / 1000));
}

export function clampPausedMs(pausedMs: unknown, startedAt: string, now: number = Date.now()) {
  const startedMs = new Date(startedAt).getTime();
  const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, now - startedMs);
  const value = typeof pausedMs === "number" && Number.isFinite(pausedMs) ? pausedMs : 0;
  return Math.min(Math.max(0, Math.round(value)), elapsedMs);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/chat-elapsed.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Estender `tests/unit/conversation-end.test.ts`**

Adicionar dentro do `describe("endConversation idempotency")` existente, após o último `it` (linha 137):

```ts
  it("desconta o tempo pausado da duração gravada", async () => {
    const { endConversation } = await import("../../lib/learning/feedback");
    const pausedMs = 10 * 60 * 1000;

    await endConversation("conversation-1", { pausedMs });

    const expected = Math.max(
      0,
      Math.round((Date.now() - new Date("2026-07-10T09:00:00.000Z").getTime() - pausedMs) / 1000)
    );
    expect(Math.abs(Number(conversation.fields.duration_seconds) - expected)).toBeLessThanOrEqual(1);
  });
```

Rodar e ver falhar: `npx vitest run tests/unit/conversation-end.test.ts` — o novo teste falha porque `duration_seconds` ainda não desconta pausas; os 3 testes antigos continuam passando.

- [ ] **Step 6: Servidor — `pausedMs` no encerramento**

a) `lib/learning/feedback.ts` — adicionar import no topo:

```ts
import { clampPausedMs } from "./chat-elapsed";
```

b) Assinatura de `endConversation` (linha 60):

```ts
export async function endConversation(conversationId: string, options: { pausedMs?: number } = {}) {
```

e na linha 65 repassar: `.then(() => finalizeConversation(conversationId, options))`.

c) Assinatura de `finalizeConversation` (linha 74):

```ts
async function finalizeConversation(conversationId: string, options: { pausedMs?: number } = {}) {
```

d) Cálculo da duração (linhas 107-110):

```ts
  const pausedMs = clampPausedMs(options.pausedMs ?? 0, context.conversation.fields.started_at);
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(context.conversation.fields.started_at).getTime() - pausedMs) / 1000)
  );
```

e) `app/api/conversations/[conversationId]/end/route.ts` — aceitar body opcional:

```ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { endConversation } from "@/lib/learning/feedback";

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json().catch(() => null)) as { pausedMs?: unknown } | null;
    const result = await endConversation(conversationId, {
      pausedMs: typeof body?.pausedMs === "number" ? body.pausedMs : 0
    });
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
```

Rodar: `npx vitest run tests/unit/conversation-end.test.ts tests/unit/chat-elapsed.test.ts`
Expected: PASS (todos)

- [ ] **Step 7: Cliente — pausa por visibilidade em `ChatConversation.tsx`**

a) Adicionar import:

```ts
import { computeActiveElapsedSeconds } from "@/lib/learning/chat-elapsed";
```

b) Novos refs junto aos existentes (após a linha 114, `retryRequestRef`):

```ts
  const pausedMsRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);
```

c) Helper e efeito de visibilidade — adicionar após o `useEffect` de autosize do composer (que termina na linha 154):

```ts
  function currentPausedMs() {
    const hiddenSince = hiddenSinceRef.current;
    return pausedMsRef.current + (hiddenSince === null ? 0 : Date.now() - hiddenSince);
  }

  useEffect(() => {
    if (readOnly) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current !== null) {
        pausedMsRef.current += Date.now() - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [readOnly]);
```

d) `finishConversation` (linha 309) — enviar o tempo pausado:

```ts
      const response = await fetch(`/api/conversations/${conversation.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pausedMs: currentPausedMs() })
      });
```

e) Render (linha 516) — passar o getter para o pill:

```tsx
        <ElapsedTimePill readOnly={readOnly} startedAt={conversation.fields.started_at} getPausedMs={currentPausedMs} />
```

f) `ElapsedTimePill` e remoção da função local (linhas 778-792) — substituir ambas por:

```tsx
function ElapsedTimePill({ startedAt, readOnly, getPausedMs }: { startedAt: string; readOnly: boolean; getPausedMs?: () => number }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => computeActiveElapsedSeconds(startedAt, getPausedMs?.() ?? 0));

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setInterval(() => setElapsedSeconds(computeActiveElapsedSeconds(startedAt, getPausedMs?.() ?? 0)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, readOnly, getPausedMs]);

  return <Pill aria-label={`Tempo de conversa: ${formatElapsedTime(elapsedSeconds)}`}><Clock3 size={16} /> {formatElapsedTime(elapsedSeconds)}</Pill>;
}
```

Nota: `getPausedMs` (`currentPausedMs`) é recriada a cada render, o que reiniciaria o intervalo a cada render — aceitável (renders são por evento e o intervalo é recriado em seguida), mas para evitar churn declarar `currentPausedMs` com `useCallback([], ...)`? Não: ela lê refs, então uma versão estável é segura. Usar:

```ts
  const currentPausedMs = useCallback(() => {
    const hiddenSince = hiddenSinceRef.current;
    return pausedMsRef.current + (hiddenSince === null ? 0 : Date.now() - hiddenSince);
  }, []);
```

(adicionar `useCallback` ao import do React na linha 6). Nesse caso o item (c) acima declara apenas o `useEffect`, sem a função solta.

- [ ] **Step 8: Verificação completa**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/learning/chat-elapsed.ts tests/unit/chat-elapsed.test.ts tests/unit/conversation-end.test.ts components/ChatConversation.tsx "app/api/conversations/[conversationId]/end/route.ts" lib/learning/feedback.ts
git commit -m "feat: pausar relógio do chat fora da aba e descontar pausas da duração"
```

---

### Task 5: Chat — descarte automático de treino abandonado

**Files:**
- Modify: `components/ChatConversation.tsx` (`finishConversation` `:303-318`, `abandonConversation` `:320-336`)

**Interfaces:**
- Consumes: `POST /api/conversations/[conversationId]/abandon` (já existe, ignora body, idempotente para status `abandoned` e 409 para `completed` — ambos seguros para fire-and-forget); `currentPausedMs` da Task 4 (não usado aqui — abandono não grava duração de treino concluído).
- Produces: `finalizedRef` e `discardActiveTraining(conversationId)` internos ao componente; nenhuma interface nova consumida por outras tasks.

Sem infra de teste de componente (vitest sem jsdom/testing-library no projeto) — verificação por suíte existente + checklist manual no navegador (Step 5). A lógica fica deliberadamente pequena e isolada.

- [ ] **Step 1: Helper de descarte + refs**

Em `components/ChatConversation.tsx`:

a) Refs junto aos da Task 4:

```ts
  const finalizedRef = useRef(false);
  const discardTimerRef = useRef<number | null>(null);
```

b) Função no nível do módulo (junto das outras helpers no fim do arquivo, antes de `formatElapsedTime`):

```ts
function discardActiveTraining(conversationId: string) {
  const url = `/api/conversations/${conversationId}/abandon`;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
  } catch {
    // Cai para o fetch keepalive abaixo.
  }
  void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
}
```

(`sendBeacon(url)` sem body faz POST vazio — a rota de abandon ignora o body.)

- [ ] **Step 2: Marcar encerramento normal**

a) Em `finishConversation`, logo após a validação `if (!response.ok || !data.ok) throw ...` (linha 311), antes do `router.push`:

```ts
      finalizedRef.current = true;
```

b) Em `abandonConversation`, logo após a validação equivalente (linha ~329), antes do `router.push`:

```ts
      finalizedRef.current = true;
```

- [ ] **Step 3: Efeito de descarte ao sair da tela ou fechar a aba**

Adicionar após o efeito de visibilidade da Task 4:

```ts
  useEffect(() => {
    if (readOnly) return;
    // StrictMode (dev) monta/desmonta o efeito uma vez na montagem; o setup
    // cancela um descarte pendente, então só uma desmontagem real dispara.
    if (discardTimerRef.current !== null) {
      window.clearTimeout(discardTimerRef.current);
      discardTimerRef.current = null;
    }
    const handlePageHide = () => {
      if (!finalizedRef.current) discardActiveTraining(conversation.id);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      discardTimerRef.current = window.setTimeout(() => {
        discardTimerRef.current = null;
        if (!finalizedRef.current) discardActiveTraining(conversation.id);
      }, 300);
    };
  }, [conversation.id, readOnly]);
```

Cobertura: `pagehide` cobre fechar a aba/janela e navegação full-page; o cleanup de unmount cobre navegação client-side (browser back, link para outra rota). Se a conversa já estiver `completed`/`abandoned` por outro caminho, a rota de abandon responde 409/ok e o descarte é inócuo.

- [ ] **Step 4: Verificação automática**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 5: Verificação manual (checklist — marcar cada item antes do commit)**

Com `npm run dev` e um usuário de teste:

1. Entrar em `/chat`, iniciar treino, esconder a aba por ~30s, voltar: o relógio não avançou durante a ocultação.
2. Sem encerrar, navegar para outra seção (browser back ou URL): a conversa fica `abandoned` no banco (`status`) e não reabre.
3. Entrar em `/chat` pela BottomNav: mostra "Nenhuma conversa em andamento" (não reabre o treino descartado).
4. Iniciar outro treino e encerrar normal: resumo abre, conversa fica `completed`, `duration_seconds` desconta pausas.
5. Botão "Sair" → "Abandonar treino": fluxo existente inalterado, sem descarte duplo (idempotente).
6. Perfil: botão "Logout" no estilo chunky, sem toggle "Ouvir respostas da IA", sem seção Conexões.
7. Palavras: paginação aparece com >20 palavras; filtros e busca respondem rápido e resetam para a página 1.

- [ ] **Step 6: Commit**

```bash
git add components/ChatConversation.tsx
git commit -m "feat: descartar treino do chat ao sair da tela ou fechar a aba"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (Logout) → Task 1. ✓
- Spec §2 (Palavras: paginação, O(n×m), UI, reset de página, `force-dynamic`) → Task 3. ✓
- Spec §3 (pausa por `visibilitychange`, duração consistente no servidor, descarte por unmount + unload, `finalizedRef`, status `abandoned`) → Tasks 4 e 5. Nota: o spec diz `beforeunload`; a implementação usa `pagehide`, que é o evento correto em mobile/Safari e igualmente cobre desktop — mesma intenção, cobertura maior.
- Spec §4 (remover toggle + Conexões, leitura sempre `true`) → Task 2. ✓
- Spec "Testes" (unitário de elapsed e paginação, e2e leve/manual) → Tasks 3, 4 (unitários) e Task 5 Step 5 (manual). ✓

**Placeholder scan:** nenhum TBD/TODO; todos os passos de código têm conteúdo completo.

**Type consistency:**
- `paginateSlice` / `WORDS_PAGE_SIZE` definidos na Task 3 Step 3, usados no teste (Step 1) e em `words.ts` (Step 5) — mesmos nomes. ✓
- `computeActiveElapsedSeconds` / `clampPausedMs` definidos na Task 4 Step 3, usados no teste, em `ChatConversation.tsx` e em `feedback.ts` — mesmos nomes e assinaturas. ✓
- `endConversation(conversationId, options?)` — Task 4 Steps 5-6 usam a mesma assinatura. ✓
- `getWordsData(filter, query, page?)` — Task 3 Steps 5-6 consistentes; chamador interno `startWeakWordsPractice` sem `page` preservado. ✓
