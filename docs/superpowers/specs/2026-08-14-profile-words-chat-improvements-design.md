# Melhorias de UI/UX — perfil, palavras e chat — Design

Data: 2026-08-14
Status: aprovado (design)

## Problema

Quatro melhorias pequenas e independentes:

1. **Botão "Sair da conta"** (`components/LogoutButton.tsx:6-17`) usa Tailwind genérico, fora do padrão chunky do app.
2. **Palavras** (`app/palavras/page.tsx`, `lib/learning/words.ts`): sem paginação; `getWordRecords` baixa TODOS os registros (`listRecordsWhereAll` sem limite) e filtra/ordena em memória — filtros e busca lentos e, com muitos dados, aparentemente quebrados.
3. **Chat** (`components/ChatConversation.tsx`): o cronômetro (`ElapsedTimePill`, `:778-806`) continua contando com a aba em segundo plano; e a conversa só sai de `active` pelo diálogo "Abandonar este treino?" — quem sai da tela ou fecha a aba deixa a conversa `active`, e `selectScopedConversation` (`lib/learning/conversation-state.ts:58-62`) a reabre ao entrar em `/chat` pela aba.
4. **Perfil** (`components/ProfilePreferences.tsx`): a opção "Ouvir respostas da IA" (`:193-200`) deve ser sempre ligada sem aparecer na UI; a seção Conexões (`:202-209`) não deve ser exibida (já configuradas via environment).

## Design

### 1. Botão Logout

Arquivo: `components/LogoutButton.tsx`.

- Texto passa a **"Logout"**.
- Classes Tailwind substituídas por `outline-button full-button` (padrão chunky de `app/globals.css:2463+`: borda 2px, radius 16px, sombra 3D, `:active` afunda). Perfil é seção neutra — `outline-button`, não `danger-button`.
- Sem mudança de comportamento (`logout()` server action inalterada).

### 2. Palavras — paginação + correção de performance dos filtros

Arquivos: `lib/learning/words.ts`, `lib/learning/pagination.ts` (novo), `app/palavras/page.tsx`, `app/globals.css`.

- **Decisão revisada na escrita do plano:** o sumário (contadores por estado, meta semanal) e a `dailyQueue` da página precisam do conjunto completo de palavras/usos de qualquer forma, então paginar/filtrar no SQL não eliminaria a carga total e ainda mudaria a semântica dos filtros (ex.: `recent` com fallback de `last_used_at` → `first_used_at`; `review`/`corrected` dependem de join com `wordUsageSummaries`). Os gargalos reais são: (a) mapeamento O(n×m) em `toWordListItem` (`.filter()` de usageSummaries por palavra) e (b) renderização/transmissão da lista inteira. A correção ataca os dois.
- **Correção O(n×m):** agrupar `usageSummaries` por `word_id` uma única vez (`Map`) antes do mapeamento — O(n+m).
- **Paginação:** query param `?page=N` (default 1), `WORDS_PAGE_SIZE = 20`. `getWordsData(filter, query, page?)` filtra e ordena como hoje (semântica inalterada), fatia com o helper puro `paginateSlice` (clamp de página) e retorna `page`, `totalPages`, `totalFiltered`. Sem `page` (uso interno de `startWeakWordsPractice`), retorna a lista completa — comportamento atual preservado.
- **Busca:** continua normalizada em memória (barata após a correção do mapeamento), por submit do form, sem debounce (YAGNI). Nova busca/filtro reseta para a página 1.
- **UI:** controles "Anterior"/"Próxima" + "Página X de Y" (classe nova `pagination-row` + `outline-button`), renderizados só quando `totalPages > 1`.
- `force-dynamic` permanece.

### 3. Chat — pausa do timer + descarte de abandono

Arquivos: `components/ChatConversation.tsx`, endpoint de `end` (`app/api/conversations/[id]/end`), `lib/learning/conversations.ts`.

**Pausa do timer:**
- Ouvir `visibilitychange`: quando `document.hidden` passa a `true`, marca o instante; ao voltar, acumula em `pausedMsRef`.
- `elapsed = now - started_at - pausedMs` (exibição no `ElapsedTimePill`).
- Ao encerrar o treino (`finishConversation`), o cliente envia o tempo pausado acumulado; o servidor grava `duration_seconds` descontando esse tempo — relógio exibido e valor salvo ficam consistentes.

**Descarte automático de treino abandonado:**
- Decisão (aprovada): navegar para outra seção do app **ou** fechar a aba do navegador = abandono → encerrar e descartar. "Sem salvar" = o treino não conta como concluído nem entra em estatísticas/histórico (o registro da conversa é marcado, não deletado — ver próximo item).
- Implementação: cleanup de unmount do componente de chat → `fetch('/api/conversations/[id]/abandon', { method: 'POST', keepalive: true })`; `beforeunload` → `navigator.sendBeacon` para o mesmo endpoint (body JSON via `Blob`).
- Flag `finalizedRef` evita o descarte quando o encerramento foi normal (finish ou abandon explícito pelo botão "Sair" → diálogo existente).
- Treino descartado reutiliza o status `abandoned` existente — já excluído de estatísticas/histórico.
- `selectScopedConversation` permanece como fallback, mas na prática não haverá mais conversa `active` órfã: entrar em `/chat` pela aba inicia treino novo.

### 4. Perfil — remover opção de áudio e seção Conexões

Arquivos: `components/ProfilePreferences.tsx`, ponto(s) de leitura de `audioEnabled`.

- Remover o `ToggleRow` "Ouvir respostas da IA" (`:193-200`).
- Garantir que a leitura de `audioEnabled` trate ausência/qualquer valor como `true` (áudio de respostas da IA sempre ligado), sem UI.
- Remover a seção Conexões (`:202-209`, os 3 `ConnectionLink`). A rota `/settings/connections` e seus componentes (`ConnectionTestButton`, `AiModelSelect`) permanecem no código, apenas sem link na UI.

## Testes

- Unitário (`tests/unit`): lógica de elapsed com pausa (extraída para função pura testável) e helper de paginação/clamp de página.
- E2E leve ou verificação manual: perfil (botão Logout, seções removidas), palavras (paginação + filtros + busca), chat (pausa em background, descarte ao sair, não reabertura).
- Build + lint ao final.
