# Design: Traduções de palavras — prevenção e backfill

Data: 2026-08-06
Status: aprovado (abordagem A, 3 seções de design; aguardando revisão do spec)

## Contexto

A aba Palavras (`app/palavras/page.tsx`) mostra a tradução de cada palavra salva,
mas **169 de 204 palavras (83%) estão sem tradução** em produção (evidência:
`backups/ai-fluency-prod-pre-chat-v2-2026-08-06.json`). Quando o campo
`translation` está vazio no Teable, a UI exibe o placeholder "Tradução a
adicionar" (`lib/learning/words.ts:284`).

Causa raiz: a análise de vocabulário por IA
(`analyzeVocabularyChunk`, `lib/learning/vocabulary-selection.ts:657-695`) roda
com `maxTokens: 600` e `timeoutMs: 4_500` (linha 666). Quando a chamada falha,
estoura o timeout ou retorna JSON truncado/inválido, o código cai em fallback
silencioso (`console.warn`, linhas 668-671 e 691-694) e a palavra é gravada com
`translation: ""` (`vocabulary-selection.ts:470` e o fallback de
`analyzeConversationVocabulary`, linhas 596-600). Depois disso, a tradução só é
preenchida se o usuário salvar a mesma palavra de novo e a IA funcionar
(linha 504). Não existe nenhum outro caminho que escreva `translation` na
tabela `words`, nem script de backfill.

Decisões tomadas com o usuário:

- Escopo: **somente traduções** na aba Palavras (não há outros pontos de review).
- Palavras novas: **nunca salvar sem tradução** — fallback em camadas antes de
  gravar; na falha total, a palavra não é salva.
- Palavras existentes: **script único em produção**, no padrão dos scripts
  existentes (dry-run por padrão, `--apply` com backup prévio).
- Abordagem A aprovada: correção na origem + script de backfill. Sem tradução
  preguiçosa na leitura e sem mudança de UX.

O campo `translation` (tipo `text`) já existe na tabela `words`
(`lib/teable/schema.ts:184`) — não é preciso migração de schema.

## Seção 1 — Prevenção: nunca salvar palavra sem tradução

Arquivo: `lib/learning/vocabulary-selection.ts`.

### 1.1 Endurecer a análise em lote

Em `analyzeVocabularyChunk` (linha 666): `timeoutMs` de 4_500 → **15_000** e
`maxTokens` de 600 → **2_000**. O chunk tem até 20 candidatos
(`VOCABULARY_ANALYSIS_CHUNK_SIZE`); 600 tokens podem truncar o JSON de resposta,
o que explica as falhas sistemáticas desde 2026-07-11.

### 1.2 Fallback por palavra (nova função)

Nova função interna `translateMissingTranslations(analyses, candidates, language)`:

- Recebe o resultado de `analyzeVocabulary` e identifica os candidatos cuja
  análise ficou com `translation` vazia.
- Para esses, faz uma **segunda tentativa em lotes de até 5 palavras**, com
  prompt simples: sistema "Traduza cada item para português brasileiro.
  Responda somente JSON válido: um array com objetos {id, translation}.
  Preserve cada id exatamente." e usuário com idioma + itens
  `{id, text, context}` (mesmo shape da análise principal).
- Parâmetros: `temperature: 0`, `maxTokens: 800`, `timeoutMs: 15_000`.
- O loop aborta após **2 falhas consecutivas** de lote (com `console.error`),
  para não ficar minutos tentando contra um provedor fora do ar; o contador
  zera a cada lote bem-sucedido.
- As traduções obtidas são mescladas no resultado (sem sobrescrever lemma nem
  partOfSpeech já obtidos).
- Chamada dentro de `analyzeConversationVocabulary`, **depois** de mesclar
  cache + análise nova e **antes** de `writeVocabularyAnalysisCache`, de modo
  que as traduções do fallback também entrem no cache e que tanto o GET de
  candidatos quanto o POST de salvamento se beneficiem.

### 1.3 Último caso: palavra não é salva

Em `persistSelectedVocabulary` (linha 442), dentro do loop de famílias: se
`family.translation` estiver vazia ao criar uma palavra **nova**, a família é
pulada (`continue`) com `console.error` contendo `conversationId`, lemma e
quantidade de candidatos afetados. A palavra permanece disponível como
candidata em conversas futuras, quando poderá ser salva com tradução.

Palavras **já existentes** sem tradução continuam sendo atualizadas
normalmente (o update da linha 504 já preenche tradução quando a IA a fornece);
o `continue` vale apenas para criação.

### 1.4 Logging ruidoso

Os dois `console.warn` de `analyzeVocabularyChunk` (linhas 669 e 692) viram
`console.error` com contexto: quantidade de candidatos no chunk e idioma. O
fallback por palavra loga `console.error` se também falhar.

Invariante resultante: **toda palavra na tabela `words` tem `translation`
não vazia** (após o backfill da Seção 2).

## Seção 2 — Backfill: `scripts/backfill-word-translations.mjs`

Script novo, no padrão de `migrate-vocabulary-integrity.mjs`, usando os helpers
de `scripts/qa-env.mjs` (`readEnv`, `required`, `teableRequest`,
`recordsFrom`). Lê `.env.local` (produção) por padrão; aceita `--env <path>`
para apontar outro arquivo (ex.: `.env.qa.local`).

### Fluxo

1. Lista todos os registros da tabela `TEABLE_WORDS_TABLE_ID`
   (`GET /table/{tableId}/record`, paginado como nos scripts existentes).
2. Filtra os que têm `fields.translation` vazia/ausente.
3. **Dry-run (padrão, sem `--apply`)**: imprime a contagem e uma amostra de até
   20 palavras (id + lemma/display_text). Não escreve nada.
4. **`--apply`**: exige `--backup <arquivo>`; grava primeiro um JSON com todos
   os registros afetados (id + fields completos), no formato dos backups em
   `backups/`.
5. Traduz em **lotes de 20**, agrupados por idioma: o script lista a tabela
   `TEABLE_LANGUAGE_PROFILES_TABLE_ID` (mesma paginação), resolve
   `fields.language_profile_id` → `language_code` e separa os lotes para que
   cada chamada à IA seja de um idioma só. Prompt igual ao da análise de
   vocabulário (sistema pedindo `[{id, translation}]` em pt-BR; usuário com
   `Idioma: <code>\nItens: [{id, text: display_text || lemma}]` — a tabela
   `words` não guarda frase de exemplo; sem idioma conhecido, o prefixo
   `Idioma:` é omitido), via chat completions usando `AI_BASE_URL`,
   `AI_API_KEY` e `AI_CHAT_MODEL` do env (`temperature: 0`, `maxTokens: 2_000`,
   timeout de 15s).
6. Para lotes que falharem ou deixarem palavras sem tradução, fallback em
   **lotes de 5** (mesmo prompt da Seção 1.2, incluindo o prefixo `Idioma:`),
   abortando após 2 falhas consecutivas para não ficar minutos contra um
   provedor fora do ar.
7. PATCH de cada registro traduzido:
   `PATCH /table/{tableId}/record/{recordId}?fieldKeyType=name` com
   `{ fields: { translation } }`.
8. Relatório final: quantidade traduzida, quantidade restante sem tradução
   (com ids, para reexecução). O script é **idempotente**: só processa as que
   continuam vazias.

### Erros

- Sem `--backup` junto de `--apply` → erro e saída.
- Falha de IA em uma palavra mesmo após o fallback → ela fica de fora do PATCH
  e aparece no relatório; o script não aborta o lote seguinte — exceto no
  fallback, que para após 2 falhas consecutivas de lote (provedor fora do ar
  não se recupera no meio do loop).
- Falha de escrita no Teable em um registro → loga e continua; o relatório
  separa "traduzidas" de "escritas com sucesso".

## Seção 3 — Testes e verificação

### Testes unitários

Em `tests/unit/vocabulary-selection.test.ts` (arquivo existente, mock do
client de IA conforme os testes atuais):

- Lote principal falha → fallback por palavra preenche as traduções e a
  palavra é salva com tradução.
- Lote + fallback falham → palavra nova **não** é salva (nenhum
  `createRecord` para aquela família) e o erro é logado.
- Palavra já existente sem tradução → update preenche `translation` quando a
  IA a fornece (comportamento atual, protegido).
- `analyzeVocabularyChunk` usa os novos parâmetros (timeout/maxTokens) —
  verificável via asserção no mock de `createChatCompletion`.

### Verificação

1. `npm run test` (ou o comando de testes unitários do projeto) verde.
2. Lint (`npm run lint`) verde nos arquivos tocados.
3. Dry-run do script contra produção (só leitura) para confirmar a contagem
   (~169) antes de aplicar.
4. `--apply --backup backups/word-translations-<data>.json` somente após ok do
   usuário.

## Fora de escopo

- Mudanças de UI na aba Palavras (o placeholder "Tradução a adicionar" deixa de
  aparecer na prática; nenhum ajuste visual é necessário).
- Tradução preguiçosa na leitura (abordagem B, descartada).
- Revisão de outros campos das palavras (part_of_speech, forms etc.).
