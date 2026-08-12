# Design: Salvamento de vocabulário do chat — performance, filtro de palavras da IA e contagem por sentido

Data: 2026-08-12
Status: aprovado pelo usuário (design)

## Contexto e problema

Ao final de um treino de chat, o salvamento de palavras no banco de vocabulário está lento. O fluxo atual:

1. `components/ChatConversation.tsx` → `POST /api/conversations/[id]/end` → resumo em `app/resumo/page.tsx`.
2. `VocabularyPicker` → `GET /api/conversations/[id]/vocabulary/candidates` → `getConversationVocabularyGroups()` (`lib/learning/vocabulary-selection.ts`), que faz full-table scans de `words` e `wordSenses` e roda análise LLM (com cache em memória, TTL 10 min).
3. `POST /api/conversations/[id]/vocabulary` → `persistSelectedVocabulary()` (`lib/learning/vocabulary-selection.ts:475-687`).

Causas da lentidão (em ordem de impacto):

1. Full-table scans de `words`, `wordUsageSummaries`, `users` e `wordSenses` a cada salvamento (custo cresce com a idade do banco).
2. N+1: `nextSenseOrder(wordId)` faz um scan completo de `wordSenses` **por sentido novo** (`lib/learning/word-senses.ts:160-163`).
3. Loop estritamente sequencial por família de palavras, com 2–5 round trips ao Teable por família.
4. Chunks de LLM sequenciais (análise em lotes de 20; fallback de tradução em lotes de 5, timeout 15 s cada) quando o cache de análise não é reutilizado.

Decisões do usuário:

- Palavras usadas pela IA **não devem nem aparecer** no seletor nem entrar no pipeline de salvamento.
- Adicionar **contador de usos por sentido** (campo novo na tabela `wordSenses`).
- Estatísticas de "novas ainda não usadas" e distinção de usadas (com nº de usos por sentido) **nas telas de Resumo e de Palavras**.
- **Otimização completa** de performance (não só o essencial).

## 1. Filtro de palavras da IA

- Em `lib/learning/vocabulary-selection.ts`, filtrar candidatos com `source !== "user"` **antes** da análise LLM (não apenas na UI). A extração (`extractVocabularyOccurrences`) continua igual — tokenização determinística com `source: "user" | "assistant"`; apenas o que entra no pipeline de análise/salvamento muda.
- `VocabularyPicker` passa a renderizar apenas a seção "Palavras que você usou"; a seção "Palavras usadas pela IA" é removida (incluindo a nota "não conta como domínio").
- Efeito colateral positivo: menos candidatos → menos chunks de LLM → análise mais rápida.

## 2. Contador de usos por sentido

- Novo campo `total_uses` (número, default 0) na tabela `wordSenses` do Teable — prod e QA. Refletir em:
  - `lib/teable/schema.ts` (definição do campo);
  - tipos em `lib/learning/conversations.ts` (ou onde o tipo de sense estiver definido);
  - script `ensure` correspondente (seguir o padrão de `scripts/ensure-*.mjs`) para criar o campo nos ambientes.
- No salvamento (`persistSelectedVocabulary`), o fluxo já resolve qual sentido foi usado (match de sentido existente ou criação de novo sentido). Incrementar `sense.total_uses` com o número de ocorrências do usuário atribuídas àquele sentido, cobrindo:
  - sentido existente reutilizado;
  - novo sentido criado (nasce com `total_uses` = ocorrências da sessão);
  - revisão implícita / reagregação de `words.total_uses` — manter consistência entre contador por palavra e soma dos contadores por sentido.
- Sensos existentes antes desta mudança começam em 0 — não há como atribuir usos históricos a sentidos retroativamente. Sem backfill.

## 3. Estatísticas de novas / não usadas

Definição: "não usada" = palavra do banco com `words.total_uses === 0`.

- **Resumo do chat** (`app/resumo/page.tsx`):
  - Lista de palavras salvas da sessão passa a mostrar o nº de usos **por sentido** (ex.: "casa — 'lar' · usado 2x").
  - Contador: "Você ainda tem N palavras no banco que nunca usou".
  - Dados via `getConversationSummary` (`lib/learning/feedback.ts`) + consulta filtrada de palavras não usadas (ver seção 4 — nada de full-table scan novo).
- **Página Palavras** (`app/palavras/page.tsx`):
  - Resumo ganha o bucket "Não usadas" (`total_uses === 0`), além dos buckets atuais por `review_state` (`lib/learning/words.ts:169`).
  - Detalhe da palavra (`app/palavras/[wordId]/page.tsx` + `components/WordSensesSection.tsx`): cada sentido mostra "usado N vezes".

## 4. Otimização de performance do salvamento

Em `persistSelectedVocabulary` e funções auxiliares:

1. **Eliminar full-table scans**:
   - `words`: buscar apenas registros cujos `canonical_key` constam nos candidatos selecionados (query filtrada).
   - `wordSenses`: `listSensesByWordIds` hoje faz full-table scan (`lib/learning/word-senses.ts:121-127`) — passar a usar query filtrada por `word_id`.
   - `wordUsageSummaries`: buscar apenas por `usage_key` / `conversation_id` da conversa atual.
   - `users`: buscar apenas o usuário da conversa.
   - Verificar no client Teable (`lib/teable/client.ts:212-218`) o fallback defensivo que transforma queries filtradas em full-scan silencioso no self-hosted; corrigir para que os filtros funcionem de verdade (ou falhar visivelmente).
2. **Eliminar o N+1 do `nextSenseOrder`**: calcular o próximo `sense_order` a partir dos sentidos já carregados em memória para a palavra, sem nova leitura (`lib/learning/word-senses.ts:160-163`).
3. **Paralelizar gravações independentes**: famílias de palavras diferentes são independentes entre si — agrupar criações/atualizações com `Promise.all` por lote, mantendo sequência apenas onde há dependência (ex.: sense precisa do `word_id` criado). Reuso do cache de análise entre GET de candidatos e POST de salvamento já existe; garantir que o POST não re-roda a análise no caminho comum.
4. **Fallbacks de conflito** (re-list completa em 400/409/422) passam a usar as mesmas queries filtradas, não full-table.

## Tratamento de erros

- Falha ao incrementar `total_uses` de um sentido não deve abortar o salvamento da palavra (log + seguir), mas falha ao criar palavra/sentido mantém o comportamento atual de fallback por conflito.
- `addSavedWordsToDailyFeedback` continua não-fatal.
- Se a query filtrada não for suportada pelo Teable self-hosted, falhar com erro explícito em vez de degradar silenciosamente para full-scan.

## Testes

Unitários (padrão atual em `tests/unit/`):

- Filtro de candidatos `source !== "user"` antes da análise (nenhum candidato da IA chega ao LLM nem ao save).
- Incremento de `sense.total_uses`: sentido existente, sentido novo, múltiplas ocorrências na mesma sessão.
- Cálculo de "não usadas" (`total_uses === 0`) para Resumo e Palavras.
- `nextSenseOrder` calculado em memória (sem chamada extra ao Teable).
- Regressão: `vocabulary-selection.test.ts` existente deve continuar verde (ajustando os casos que assumem candidatos da IA).

## Fora de escopo

- Backfill de contadores por sentido para dados históricos.
- Mudanças no SRS/flashcards.
- Popular a tabela `wordOccurrences` (hoje definida mas não escrita).
