# Suporte a Múltiplos Significados (Polissemia) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Cada fase deve ser detalhada em subfases TDD na hora da execução (as subfases já estão esboçadas em cada fase).

**Goal:** Permitir que cada palavra do vocabulário tenha múltiplos significados (sentidos), cada um com tradução, exemplo e agendamento SRS próprio, capturados via IA no chat e exercitados individualmente nos flashcards — sem quebrar os dados de produção existentes.

**Architecture:** Nova tabela filha `word_senses` no Teable (1 word → N senses), com campos SRS espelhados de `words`. A tabela `words` mantém `translation` e os agregados SRS como **cache do sentido primário / agregado** durante toda a transição. A captura no chat passa a detectar "novo sentido de palavra conhecida" via análise de IA com contexto dos sentidos existentes; a revisão passa a agendar e avaliar por sentido.

**Tech Stack:** Next.js 15 (App Router) + React 19, TypeScript, Teable (API REST via `lib/teable/client.ts`), Vitest (unit), Playwright (e2e), scripts `.mjs` para migração de schema/dados.

## Global Constraints

- Compatibilidade retroativa é obrigatória: `words.translation` continua funcionando como cache do sentido primário em **todas** as fases; nenhuma leitura existente pode quebrar.
- Backup antes de qualquer migração de dados (padrão `scripts/backup-learning-data.mjs`, saída em `backups/`).
- Scripts de schema seguem o padrão dry-run/`--apply` de `scripts/ensure-srs-v2-fields.mjs` (lê `.env.local` via `scripts/qa-env.mjs`).
- A tabela `wordOccurrences` permanece abandonada até a Fase 4 (não escrever nela antes).
- Mudanças mínimas e incrementais; cada fase deployável isoladamente.
- Testes: `npm run test:unit` (Vitest), `npm run typecheck`, `npm run lint`; gate completo `npm run test:release`.

---

## FASE 0 — Schema e fundação de dados

### Objetivo

Criar a tabela `word_senses` no Teable, registrá-la no schema do app, criar a camada de acesso (`lib/learning/word-senses.ts`) e fazer backfill de um sentido primário por palavra existente. Nenhum comportamento do app muda nesta fase.

### Arquivos a criar/modificar

- Criar `scripts/ensure-word-senses-table.mjs` — cria a tabela e os campos (dry-run/`--apply`).
- Criar `scripts/backfill-word-senses.mjs` — migração de dados (dry-run/`--apply`), com chamada prévia a `scripts/backup-learning-data.mjs`.
- Modificar `lib/teable/schema.ts` — adicionar entrada `wordSenses` em `teableSchema` (após `words`, ~schema.ts:201).
- Modificar `lib/learning/conversations.ts` — adicionar tipo `WordSenseFields` (junto a `WordFields`, :63-90).
- Criar `lib/learning/word-senses.ts` — camada de acesso.
- Modificar `.env.example` — adicionar `TEABLE_WORD_SENSES_TABLE_ID=` (após `TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID=`, :31).
- Modificar `package.json` — adicionar scripts `senses:ensure-table`, `senses:backfill`, `senses:backfill:apply`.
- Criar `tests/unit/word-senses.test.ts`.

### Definição da tabela `word_senses` (bloco a inserir em `lib/teable/schema.ts`)

```ts
{
  key: "wordSenses",
  envName: "TEABLE_WORD_SENSES_TABLE_ID",
  displayName: "WordSenses",
  purpose: "Individual meanings (senses) of a vocabulary word, with per-sense SRS.",
  fields: [
    { name: "word_id", type: "relation", note: "Words" },
    { name: "sense_key", type: "text", note: "Unique user + language profile + lemma + normalized translation key." },
    { name: "translation", type: "text" },
    { name: "part_of_speech", type: "text" },
    { name: "example_sentence", type: "longText" },
    { name: "source", type: "singleSelect", note: "chat | manual | backfill" },
    { name: "is_primary", type: "checkbox" },
    { name: "sense_order", type: "number", note: "1-based display order; primary is 1." },
    { name: "review_due_at", type: "date" },
    { name: "review_interval_days", type: "number" },
    { name: "review_ease", type: "number" },
    { name: "review_streak", type: "number" },
    { name: "lapse_count", type: "number" },
    { name: "learning_step", type: "number" },
    { name: "last_reviewed_at", type: "date" },
    { name: "last_rating", type: "singleSelect" },
    { name: "average_response_time_ms", type: "number" },
    { name: "review_state", type: "singleSelect" },
    { name: "review_version", type: "text" },
    { name: "leech_flagged_at", type: "date" },
    { name: "created_at", type: "date" }
  ]
}
```

Observações: `user_id`/`language_profile_id` não se repetem — herdam-se via `word_id`; o escopo é sempre resolvido pela word pai. `sense_key` usa o mesmo formato JSON-array de `canonicalVocabularyKey` (`JSON.stringify([userId, profileId, lemma, normalizedTranslation])`) para permitir lookup diacritic-insensitive como em `matchesCanonicalVocabularyKey` (vocabulary-selection.ts:575).

### Tipo TypeScript (a inserir em `lib/learning/conversations.ts`)

```ts
export type WordSenseFields = {
  Name?: string;
  word_id: string;
  sense_key?: string;
  translation: string;
  part_of_speech?: string;
  example_sentence?: string;
  source?: "chat" | "manual" | "backfill";
  is_primary?: boolean;
  sense_order?: number;
  review_due_at?: string;
  review_interval_days?: number;
  review_ease?: number;
  review_streak?: number;
  lapse_count?: number;
  learning_step?: number;
  last_reviewed_at?: string;
  last_rating?: "forgot" | "hard" | "good" | "easy";
  average_response_time_ms?: number;
  review_state?: "new" | "learning" | "review" | "difficult" | "suspended";
  review_version?: string;
  leech_flagged_at?: string;
};
```

### Camada de acesso — `lib/learning/word-senses.ts` (assinaturas novas)

```ts
import type { TeableRecord } from "@/lib/teable/client";
import type { WordFields, WordSenseFields } from "./conversations";

export function canonicalSenseKey(userId: string, profileId: string, lemma: string, translation: string): string;
export function matchesCanonicalSenseKey(storedKey: string | undefined, senseKey: string): boolean;

export async function listSensesByWordIds(wordIds: string[]): Promise<Map<string, TeableRecord<WordSenseFields>[]>>;
export async function findSenseByKey(senseKey: string): Promise<TeableRecord<WordSenseFields> | undefined>;
export async function getPrimarySense(wordId: string): Promise<TeableRecord<WordSenseFields> | undefined>;

export async function createWordSense(fields: WordSenseFields): Promise<TeableRecord<WordSenseFields>>;
// Idempotente: em 400/409/422 relê por sense_key e retorna o existente
// (mesmo padrão do catch em persistSelectedVocabulary, vocabulary-selection.ts:492-497).

export async function updateWordSense(senseId: string, fields: Partial<WordSenseFields>): Promise<TeableRecord<WordSenseFields>>;

// Fallback de leitura durante a transição: sentidos da palavra ou, se a palavra
// ainda não tem sentidos, um sentido sintético a partir de words.translation.
export function synthesizeLegacySense(word: TeableRecord<WordFields>): WordSenseFields;

// Agregação sentidos → word (usada nas Fases 1-2 para manter o cache em words).
export function aggregateSenseReviewToWordFields(senses: TeableRecord<WordSenseFields>[]): Partial<WordFields>;
// Regra de agregação (definida aqui, usada nas fases seguintes):
//   review_due_at       = min(review_due_at dos sentidos não suspensos) — sentido mais urgente manda
//   review_state        = pior estado (difficult > learning > review > new), para a fila não esconder sentidos fracos
//   review_streak       = min(streak)  |  lapse_count = sum(lapses)
//   last_rating/last_reviewed_at = do sentido revisado mais recentemente
//   translation/part_of_speech   = do sentido is_primary
```

### Script `scripts/ensure-word-senses-table.mjs` (padrão)

Segue `ensure-srs-v2-fields.mjs`: lê `.env.local` via `readEnv`/`required`/`teableRequest` de `scripts/qa-env.mjs`; se a tabela não existir, cria via `POST /api/base/{baseId}/table` com os campos acima; se existir, faz diff campo a campo (`GET /api/table/{tableId}/field` + `POST` dos faltantes). Imprime relatório JSON `{ ok, mode: "dry-run"|"apply", fields: [...] }`.

### Backfill `scripts/backfill-word-senses.mjs`

Para cada registro de `words` com `translation` não vazio e **sem** sentido existente (lookup por `sense_key` = `canonicalSenseKey(user_id, language_profile_id, lemma, translation)`), cria:

- `translation`/`part_of_speech` copiados da word, `is_primary: true`, `sense_order: 1`, `source: "backfill"`;
- campos SRS **copiados da word** (`review_due_at`, `review_interval_days`, `review_ease`, `review_streak`, `lapse_count`, `learning_step`, `last_reviewed_at`, `last_rating`, `average_response_time_ms`, `review_state`, `review_version`, `leech_flagged_at`) — assim o histórico SRS do usuário migra intacto para o sentido primário;
- `created_at` = agora.

Dry-run imprime contagens (`would_create`, `skipped_existing`, `skipped_no_translation`); `--apply` grava em lotes. Rodar `npm run scope:backup` antes e gravar o caminho do backup no relatório.

### Interfaces

**Produzidas**: `WordSenseFields`; tabela `wordSenses` no schema; funções de `word-senses.ts` acima.
**Consumidas**: `getTeableClient()` (`listAllRecords`, `createRecord`, `updateRecord` — lib/teable/client.ts:64); `normalizeVocabularyToken` (vocabulary-selection.ts:72) para a parte da tradução no `sense_key`.

### Subfases TDD (detalhar na execução)

- 0.1 — Script de schema + entrada em `schema.ts` + `.env.example`; teste de contrato (estilo `tests/unit/chat-schema-contract.test.ts`) validando que `getSchemaTable("wordSenses")` expõe todos os campos.
- 0.2 — `canonicalSenseKey`/`matchesCanonicalSenseKey`/`synthesizeLegacySense`/`aggregateSenseReviewToWordFields` puros, com testes Vitest primeiro (incluindo agregação min-due e fallback de palavra sem sentidos).
- 0.3 — CRUD `listSensesByWordIds`/`findSenseByKey`/`createWordSense`/`updateWordSense` com client mockado (padrão dos testes de `teable-filtered-listing.test.ts`).
- 0.4 — Script de backfill com teste de lógica pura (quais palavras geram sentido, idempotência), depois dry-run em QA e `--apply` em produção com backup.

### Comandos de teste

```
npm run test:unit -- word-senses
npm run typecheck && npm run lint
node scripts/ensure-word-senses-table.mjs            # dry-run
node scripts/ensure-word-senses-table.mjs --apply
npm run scope:backup
node scripts/backfill-word-senses.mjs                # dry-run
node scripts/backfill-word-senses.mjs --apply
```

### Riscos / pontos de atenção

- **Palavras com `translation` vazio** ("Tradução a adicionar"): não recebem sentido no backfill — o fallback `synthesizeLegacySense` cobre leitura; a Fase 1 cria o sentido quando a tradução chegar.
- **Idempotência do backfill**: reexecução não pode duplicar sentidos — o `sense_key` é a guarda (testar reexecução em QA).
- Palavras cujo `lemma` mudou de normalização ao longo do tempo (comentário em vocabulary-selection.ts:571): normalizar os dois lados ao comparar, como `matchesCanonicalVocabularyKey` faz.
- Campo `word_id` relation no Teable: confirmar no dry-run que a relation aponta para `TEABLE_WORDS_TABLE_ID` (relation criada como campo de link na tabela filha; validar manualmente no Teable após `--apply`).

### Critério de done

- Tabela existe em QA e produção com todos os campos; `getSchemaTable("wordSenses")` retorna a definição completa.
- Backfill aplicado: 100% das words com `translation` têm exatamente 1 sentido primário com SRS copiado; relatório do script sem `skipped_existing` inesperados; backup em `backups/`.
- `npm run test:unit` e `npm run typecheck` verdes; app funcionando sem nenhuma mudança de comportamento visível.

---

## FASE 1 — Captura de múltiplos significados no chat

### Objetivo

A análise de vocabulário detecta quando uma palavra **já conhecida** foi usada com significado diferente; o picker do `/resumo` a exibe com badge "novo significado"; ao salvar, grava-se um novo registro em `word_senses` (ou palavra nova + sentido primário), mantendo `words.translation` como cache do primário.

### Arquivos a modificar

- `lib/learning/vocabulary-selection.ts` — prompt de análise, tipos, `filterNewVocabularyCandidates` (:278), `groupNewVocabularyCandidates` (:290), `getConversationVocabularyGroups` (:312), `persistSelectedVocabulary` (:413).
- Componente do picker no resumo — localizar na execução o componente que renderiza `groups` (em `app/resumo/` ou componente dedicado) — badge "novo significado".
- `app/api/conversations/[conversationId]/vocabulary/candidates/route.ts` — sem mudança de assinatura (o shape de `groups` ganha campos opcionais).
- Criar `tests/unit/vocabulary-new-sense.test.ts`; estender `tests/unit/vocabulary-selection.test.ts`.

### Mudanças de tipos e análise de IA

`VocabularyLinguisticData` ganha `isNewSense`; o grupo ganha marcação:

```ts
// vocabulary-selection.ts
type VocabularyLinguisticData = {
  lemma: string;
  translation: string;
  partOfSpeech: string;
  isNewSense?: boolean;        // true quando a IA detectou sentido distinto dos existentes
};

export type VocabularyCandidateGroup = {
  // ...campos atuais (vocabulary-selection.ts:25-38)...
  kind: "new_word" | "new_sense_of_existing";
  existingWordId?: string;     // preenchido quando kind === "new_sense_of_existing"
};
```

`analyzeVocabularyChunk` (:668) passa a receber os sentidos existentes das palavras conhecidas presentes no chunk, e o prompt muda. Novo shape do JSON que a IA retorna:

```json
[
  {
    "id": "candidate-id",
    "lemma": "bank",
    "translation": "banco (assento)",
    "part_of_speech": "noun",
    "sense_status": "new_sense"
  }
]
```

- `sense_status`: `"known_sense"` (mesmo significado já cadastrado — candidato descartável), `"new_sense"` (palavra conhecida, significado novo — vai ao picker com badge), `"new_word"` (lemma desconhecido — fluxo atual).
- Prompt (system) revisado: *"Analise vocabulário no idioma informado. Para cada item, se o lemma consta em 'Palavras conhecidas', compare o significado no contexto com os sentidos cadastrados: se for um significado diferente, responda sense_status=new_sense e traduza o NOVO significado; se for o mesmo, sense_status=known_sense. Responda somente JSON válido: array de {id, lemma, translation, part_of_speech, sense_status}."* — a lista "Palavras conhecidas" é montada em `getConversationVocabularyGroups`/`persistSelectedVocabulary` a partir de `listSensesByWordIds` (Fase 0): `{ lemma, senses: [traduções existentes] }`.

`filterNewVocabularyCandidates` (:278) **deixa de descartar** candidatos cujo lemma existe quando a análise marcou `new_sense`; na prática o filtro move-se para depois da análise em `groupNewVocabularyCandidates` (:290), que hoje já filtra por `existingKeys` (:301-309) — essa filtragem passa a manter grupos com `kind === "new_sense_of_existing"`.

`persistSelectedVocabulary` (:413):

```ts
// Trecho novo dentro do loop de famílias, após resolver `word` (existente ou criada):
const senseFields: WordSenseFields = {
  word_id: resolvedWord.id,
  sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation),
  translation: family.translation,
  part_of_speech: family.partOfSpeech,
  example_sentence: relevant[0]?.context ?? "",
  source: "chat",
  is_primary: !createdWord ? false : true,
  sense_order: createdWord ? 1 : (await nextSenseOrder(resolvedWord.id)),
  review_due_at: reviewDue,          // mesmo default de 7 dias das words novas (:436)
  review_state: "new",
  created_at: now
};
await createWordSense(senseFields);  // idempotente por sense_key
```

Regras:

- **Palavra nova**: cria word (fluxo atual :472-497) + sentido primário (`is_primary: true`).
- **Palavra existente, novo sentido**: cria sentido não-primário; `words.translation` **não** é alterado (permanece o primário); agregados SRS da word recalculados via `aggregateSenseReviewToWordFields`.
- **Palavra existente sem nenhum sentido** (buraco do backfill, translation vazia): se `family.translation` preencher `words.translation` (:514), cria também o sentido primário correspondente.

### Picker (UI)

O card do grupo com `kind === "new_sense_of_existing"` mostra badge **"novo significado"** e subtítulo "você já conhece «banco (instituição)»" (primeiro sentido existente), usando os componentes existentes (`Pill`). Sem nova rota: `candidates/route.ts` já devolve `groups` (:7), apenas com os campos novos.

### Interfaces

**Produzidas**: `VocabularyCandidateGroup.kind`/`existingWordId`; `VocabularyLinguisticData.isNewSense`; escrita em `word_senses` no save.
**Consumidas**: `listSensesByWordIds`, `createWordSense`, `canonicalSenseKey`, `aggregateSenseReviewToWordFields` (Fase 0).

### Subfases TDD (detalhar na execução)

- 1.1 — Parser do novo JSON da IA (`sense_status`) com testes de respostas malformadas/ausentes (fallback = comportamento atual, sem `isNewSense`).
- 1.2 — `groupNewVocabularyCandidates` mantém grupos `new_sense_of_existing` e continua descartando `known_sense`; testes em `vocabulary-selection.test.ts`.
- 1.3 — `persistSelectedVocabulary`: testes dos 3 caminhos (palavra nova + primário; novo sentido em existente; palavra legada sem sentido) com client mockado.
- 1.4 — Badge no picker + teste de contrato de UI (padrão `selection-ui.test.ts`) e ajuste e2e do fluxo de resumo se houver cobertura (`tests/e2e/`).

### Comandos de teste

```
npm run test:unit -- vocabulary
npm run test:unit -- selection-ui
npm run typecheck && npm run lint
npm run test:e2e -- resumo   # ou spec equivalente do fluxo pós-chat
```

### Riscos / pontos de atenção

- **Cache de análise** (`vocabularyAnalysisCache`, :70): entradas antigas não têm `sense_status` — tratar ausência como "comportamento legado" e invalidar naturalmente pelo TTL de 10 min.
- **Falsos positivos da IA** (mesma tradução com redação diferente): dedupe por `sense_key` normalizado antes de criar; se a tradução normalizada já existe como sentido, tratar como `known_sense` mesmo que a IA diga `new_sense`.
- Candidatos com tradução vazia continuam sendo pulados para palavras novas (:466-471) — manter a mesma guarda para novos sentidos.
- `MAX_VOCABULARY_CANDIDATES = 80` (:53) agora inclui novos sentidos: aceitável, mas monitorar se o picker fica ruidoso; não mudar o cap nesta fase.

### Critério de done

- Em QA: conversa usando palavra conhecida com significado novo → picker mostra o item com badge → salvar cria registro em `word_senses` (verificável no Teable) sem alterar `words.translation`.
- Palavra nova continua criando word + sentido primário; re-execução do save (mesma conversa) não duplica sentidos.
- Testes unitários e e2e do fluxo verdes.

---

## FASE 2 — SRS por sentido na revisão inteligente

### Objetivo

A fila diária e as sessões de flashcard passam a selecionar **sentidos devidos** (não apenas palavras devidas); cada card congelado referencia o sentido exercitado (`target_sense_id`); a atualização SRS grava no sentido e re-agrega na word para compatibilidade.

### Arquivos a modificar

- `lib/teable/schema.ts` — adicionar `target_sense_id` (relation → WordSenses) em `flashcards` (:303-323) e `sense_id` em `flashcardAttempts` (:326-349).
- Criar `scripts/ensure-word-senses-flashcard-fields.mjs` (padrão `ensure-srs-v2-fields.mjs`) + script npm `senses:flashcard-fields`.
- `lib/learning/flashcard-contracts.ts` — `Flashcard` ganha `targetSenseId?: string`.
- `lib/learning/flashcards.ts` — `createFlashcardPractice` (:205), `selectFlashcardWords` (:164), `buildActiveRecallCard` (:771), `flashcardToRecord` (:820)/`flashcardRecordToCard` (:840), e os dois pontos de `calculateAdaptiveReview` (:527 e :681).
- `lib/learning/daily-queue.ts` — seleção passa a operar sobre pares (word, sense).
- `lib/learning/flashcard-type-selection.ts` — `chooseCardTypes` (:43) recebe `review_state` do **sentido**.
- `lib/learning/spaced-repetition.ts` — sem mudança de algoritmo; `calculateAdaptiveReview` (:70) recebe `ReviewFields` do sentido (mesmo shape).
- Criar `tests/unit/word-senses-srs.test.ts`; estender `tests/unit/flashcards.test.ts`, `tests/unit/daily-queue.test.ts`, `tests/unit/flashcard-persistence.test.ts`.

### Modelo de seleção (assinaturas)

```ts
// lib/learning/word-senses.ts (Fase 0) — resolução usada pela fila:
export type DueSense = {
  word: TeableRecord<WordFields>;
  sense: TeableRecord<WordSenseFields>;   // real ou sintetizado via synthesizeLegacySense
  synthetic: boolean;                      // true = palavra ainda sem sentidos (legado)
};
export function resolveDueSenses(
  words: TeableRecord<WordFields>[],
  sensesByWord: Map<string, TeableRecord<WordSenseFields>[]>,
  now?: Date
): DueSense[];
// Palavras sem sentidos entram com sentido sintético (campos SRS da própria word),
// preservando o comportamento atual para dados ainda não migrados.

// lib/learning/flashcards.ts — card por sentido:
function buildActiveRecallCard(
  word: TeableRecord<WordFields>,
  sense: TeableRecord<WordSenseFields>,
  desiredType: "target_to_native" | "native_to_target" | "cloze" | "listening",
  phrase: GeneratedPhrase | undefined,
  index: number
): Flashcard
// translation = sense.fields.translation (não mais word.fields.translation, :773)
// acceptedAnswers permanece lemma/display_text; respostas com a tradução de OUTRO
// sentido da mesma palavra são resolvidas pelo fluxo de rating manual já existente.
```

Atualização SRS (substitui :527 e :681):

```ts
const review = calculateAdaptiveReview(sense.fields, [{ rating, responseTimeMs, cardType: card.type }], new Date(now), timeZone, sense.id);
await client.updateRecord<WordSenseFields>("wordSenses", sense.id, reviewToSenseFields(review));
// reviewToSenseFields = mesma projeção de reviewToWordFields (spaced-repetition.ts:124),
// exportada como função genérica ou duplicada minimalmente.
const refreshed = await listSensesByWordIds([word.id]);
await client.updateRecord<WordFields>("words", word.id, aggregateSenseReviewToWordFields(refreshed.get(word.id)!));
```

`flashcardToRecord` grava `target_sense_id`; `flashcardRecordToCard` lê com default `undefined` — **cards congelados antigos sem `target_sense_id` continuam válidos** (caem no caminho legado: atualizam a word diretamente, como hoje).

### Subfases TDD (detalhar na execução)

- 2.1 — Script de campos (`target_sense_id`, `sense_id`) + contrato de schema; `Flashcard.targetSenseId` opcional com round-trip `flashcardToRecord`/`flashcardRecordToCard` (teste em `flashcard-persistence.test.ts`).
- 2.2 — `resolveDueSenses` puro: due por sentido, sentido sintético para legado, min-due na word; testes em `daily-queue.test.ts`/`word-senses-srs.test.ts`.
- 2.3 — `buildActiveRecallCard` por sentido + mix de tipos por `review_state` do sentido (`flashcard-type-selection.test.ts`).
- 2.4 — Persistência de review no sentido + re-agregação na word; undo (`review_snapshot`, :601-605) passa a snapshotar também campos do sentido — estender o snapshot com chave `sense:{id}`. **Obrigatória, não opcional.**
- 2.5 — E2E: sessão diária apresenta card de sentido específico e grava SRS no sentido (Playwright, QA).

### Comandos de teste

```
npm run test:unit -- flashcards daily-queue spaced-repetition word-senses
npm run typecheck && npm run lint
npm run test:e2e -- flashcards
```

### Riscos / pontos de atenção

- **Cards congelados antigos** (sessões `active`/`preparing` criadas antes do deploy): sem `target_sense_id`, o caminho legado atualiza a word — manter esse branch até não haver sessões antigas ativas (o TTL de sessões ativas é curto; verificar na execução).
- **Undo**: snapshot atual só cobre `words` (:601); sem snapshot do sentido, undo deixaria sentido e word divergentes — subfase 2.4 é obrigatória.
- **Fila diária**: `computeDailyQueue` (:51) recebe words; a versão por sentido deve manter o contrato `DailyQueue` (ids de sessão) — decisão: `sessionWordIds` continua com word ids, e a resolução word→sentido-devido acontece na montagem dos cards, escolhendo o sentido mais devido da palavra. Isso minimiza mudança no e2e e na quota de novos cards.
- **Novos sentidos = novos cards**: `isNewWord` (:47) usa `last_reviewed_at` da word; um sentido novo de palavra já revisada não consumiria quota de novos — aceitar nesta fase (regra de quota por sentido fica para refinamento futuro; documentar).
- Dupla escrita (sentido + agregado) não é transacional no Teable: se a segunda falhar, word fica stale até a próxima revisão — aceitável; logar erro (padrão try/catch com `console.warn` já usado em vocabulary-selection.ts:532-540).

### Critério de done

- Em QA: card gerado para sentido específico usa a tradução do sentido; após rating, `word_senses.review_due_at` avança e `words.review_due_at` = min dos sentidos.
- Cards de sessões antigas (sem `target_sense_id`) completam e avaliam sem erro.
- Undo reverte sentido e word consistentemente; `npm run test:unit` e e2e de flashcards verdes.

---

## FASE 3 — UI de sentidos

### Objetivo

A página de detalhe da palavra lista todos os sentidos com o estado SRS de cada um e permite adicionar sentido manualmente; o trainer indica qual sentido está sendo exercitado; respostas aceitas consideram os sentidos.

### Arquivos a modificar

- `lib/learning/words.ts` — `getWordDetail` (:159) passa a incluir `senses: WordSenseListItem[]`.
- `app/palavras/[wordId]/page.tsx` — nova seção "Significados".
- Criar `components/WordSensesSection.tsx` (server) e `components/AddSenseForm.tsx` (client).
- Criar `app/api/words/[wordId]/senses/route.ts` — `POST` para adicionar sentido manual.
- `components/FlashcardTrainer.tsx` — indicador "significado N de M".
- Criar `tests/unit/word-senses-ui.test.ts` (contrato, padrão `ui-redesign-contracts.test.ts`).

### Interfaces

```ts
// lib/learning/words.ts
export type WordSenseListItem = {
  id: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence: string;
  isPrimary: boolean;
  source: "chat" | "manual" | "backfill";
  reviewState: "new" | "learning" | "review" | "difficult" | "suspended";
  reviewDueAt: string;
  reviewStreak: number;
  lapseCount: number;
  needsReview: boolean;
};
// getWordDetail retorna { languageCode, word, senses: WordSenseListItem[] }

// app/api/words/[wordId]/senses/route.ts
export async function POST(request: Request, { params }: { params: Promise<{ wordId: string }> }): Promise<Response>
// body: { translation: string; partOfSpeech?: string; exampleSentence?: string }
// → createWordSense({ ..., source: "manual", is_primary: false, review_state: "new", review_due_at: now })
// 409 se sense_key já existe; 404 se word fora do escopo do usuário.
```

- **/palavras/[wordId]**: hero mantém `word.translation` (primário); seção lista cada sentido com `Pill` de estado (`reviewState`, `needsReview`), streak/lapses e exemplo; botão "Adicionar significado" abre o form.
- **FlashcardTrainer**: quando `card.targetSenseId` existe e a palavra tem >1 sentido, exibir "significado 2 de 3" (ordem por `sense_order`) junto ao card; sem `targetSenseId` (legado), nada muda.
- **acceptedAnswers por sentido**: em cards `native_to_target`/`cloze` o expected é a palavra (inalterado); em `target_to_native`/`listening` o expected passa a ser a tradução do sentido (já feito na Fase 2), e as demais traduções da palavra entram em `acceptedAnswers` como sinônimos aceitos — ajuste pontual em `buildActiveRecallCard` se a Fase 2 não tiver coberto, com teste em `flashcard-answer.test.ts`.

### Subfases TDD (detalhar na execução)

- 3.1 — `getWordDetail` com `senses` (fallback `synthesizeLegacySense` para palavras sem sentidos); teste unitário.
- 3.2 — `POST /api/words/[wordId]/senses` com validações (escopo, duplicata por `sense_key`, translation obrigatória); testes de rota (padrão `flashcard-api.test.ts`).
- 3.3 — Seção de sentidos na página + form client; teste de contrato de UI.
- 3.4 — Indicador no `FlashcardTrainer` + acceptedAnswers multi-sentido; e2e de flashcards atualizado.

### Comandos de teste

```
npm run test:unit -- word-senses flashcard-answer
npm run typecheck && npm run lint
npm run test:e2e
```

### Riscos / pontos de atenção

- Palavras legadas sem sentidos devem renderizar a seção via sentido sintético (nunca lista vazia quebrada).
- Sentido manual duplicado (mesma tradução normalizada) → 409 com mensagem clara; não criar duplicatas.
- Manter a página enxuta → extrair a seção para componente; não inflar o server component.
- `AddSenseForm` é client component novo: seguir padrões de acessibilidade dos testes `accessibility-contracts.test.ts` (labels, foco).

### Critério de done

- Em QA: página de uma palavra polissêmica lista todos os sentidos com SRS individual; é possível adicionar sentido manual e ele aparece na lista e passa a ser agendável na fila.
- Trainer exibe "significado N de M" em cards de palavras multi-sentido; testes verdes.

---

## FASE 4 — Reativação de contexto (OPCIONAL / futura)

### Objetivo

Reativar a escrita em `wordOccurrences` vinculando cada ocorrência ao `sense_id` usado no contexto, para que cards cloze usem frases reais do usuário por sentido.

> **Fase opcional**: executar somente após Fases 0-3 estabilizadas em produção. Não é pré-requisito para nada.

### Arquivos a modificar

- `lib/teable/schema.ts` — adicionar `sense_id` (relation → WordSenses) em `wordOccurrences` (:203-216) via novo script `ensure-word-occurrences-sense-field.mjs`.
- `lib/learning/vocabulary-selection.ts` — `persistSelectedVocabulary` grava occurrences dos candidatos selecionados com `sense_id` do sentido criado/encontrado.
- `lib/learning/flashcards.ts` — `generatePhrases` (:756) passa a preferir `sentence_context` de occurrences do sentido como cloze antes de chamar a IA.

### Subfases TDD (detalhar na execução)

- 4.1 — Campo `sense_id` + escrita de occurrences no save (dedupe por `occurrence_key`, schema.ts:209).
- 4.2 — Cloze a partir de frases reais: seleção da occurrence mais recente do sentido com fallback para IA/determinístico; testes em `flashcard-generation-fallback.test.ts`.

### Comandos de teste

```
npm run test:unit -- flashcard-generation-fallback vocabulary
npm run test:e2e -- flashcards
```

### Riscos / pontos de atenção

- Volume de escrita: occurrences por candidato selecionado apenas (não por mensagem), para não inflar a tabela — definir cap (ex.: 3 por sentido por conversa).
- Frases reais podem conter erros do usuário: usar apenas occurrences `was_correct` (flag já existe no schema, :214).
- Tabela esteve abandonada — validar em QA que o schema real no Teable ainda corresponde à definição antes de escrever.

### Critério de done

- Cards cloze de sentidos com occurrences corretas usam frase real do usuário; fallback intacto quando não há occurrence; dedupe por `occurrence_key` comprovado em reexecução.

---

## Ordem de execução e gates

1. Fase 0 → deploy (sem mudança de comportamento) → backfill em produção com backup.
2. Fase 1 → deploy (captura começa a popular `word_senses`).
3. Fase 2 → deploy (SRS por sentido; word agregada mantém compatibilidade).
4. Fase 3 → deploy (UI).
5. Fase 4 → quando houver demanda.

Gate por fase: `npm run test:release` (lint + typecheck + unit + build + integration + e2e + smoke) verde em QA antes de produção, e backup em `backups/` antes de qualquer script `--apply` que escreva dados.
