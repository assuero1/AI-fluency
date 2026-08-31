# Sessão "Palavras Novas" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova sessão de prática em que a IA escolhe palavras inéditas com base no banco do usuário, monta 3 frases curtas por palavra (palavras conhecidas + a nova), toca o áudio de cada frase, o usuário traduz para o português e a IA corrige como professor — podendo registrar significados novos no banco de sentidos.

**Architecture:** Reaproveita a infraestrutura de flashcards (`practice_sessions`, `flashcards`, `flashcard_attempts`) com um novo `type` de sessão (`new_words`) e um novo `card_type` (`translation`). Lógica nova isolada em módulos próprios (`new-words-*`), seguindo os padrões existentes: sessão `preparing→active`, tentativa idempotente por `client_attempt_id`, conclusão idempotente por `clientCompletionId`, SRS por sentido (`applyReviewToSense`) e eventos de telemetria. O julgamento da tradução é feito por IA (com fallback determinístico), e a expansão de significados usa o sistema de sentidos (`word_senses`) com dedupe por `sense_key`.

**Tech Stack:** Next.js App Router + TypeScript, Supabase (fachada `TeableClient`), IA via `createChatCompletion` (OpenAI-compatible), TTS via `/api/voice/synthesize` + `requestSpeech`, Vitest para testes unitários.

**Spec:** Requisitos do usuário (2026-08-31):
1. O usuário define quantas palavras novas quer aprender: **3, 5 ou 8**.
2. A IA analisa o banco de palavras existente e a sessão abre.
3. Para cada palavra nova, a IA cria **3 frases** usando palavras que o usuário já tem + a palavra nova, com **2 a 6 palavras totais** por frase.
4. Cada frase tem áudio gerado; **o áudio toca quando a frase aparece**.
5. Uma frase por vez; a frase está sempre no idioma de aprendizado e o usuário **traduz para o português**.
6. A IA corrige a tradução seguindo o significado da palavra no banco, **agindo como professor**: se a tradução não corresponder exatamente ao banco mas estiver correta, a IA reconhece e pode **adicionar o novo significado aos sentidos da palavra** (sistema `word_senses`).

## Global Constraints

- Todo texto de UI e mensagens de erro em **português brasileiro** (padrão do app).
- Explicações/correções da IA sempre em pt-BR (`REGRA OBRIGATÓRIA` já usada nos prompts do tutor).
- Toda escrita em banco passa pela fachada `getTeableClient()`; keys de tabela em `lib/supabase/tables.json` (não há tabelas novas).
- Migrations idempotentes, compatíveis com re-run (padrão `0001`–`0006`).
- Idiomas suportados: `en`, `es`, `fr`, `it` (`speechLocales`); nativo do aluno: pt-BR.
- iOS: `audio.play()` programático só funciona num `<audio>` destravado dentro de um gesto do usuário (`unlockAudioForPlayback`); todo autoplay precisa de fallback visível (botão de replay).
- Testes: `npm run test:unit` (Vitest); typecheck: `npm run typecheck`; lint: `npm run lint`.
- Commits no estilo do repo: `feat: ...` / `fix: ...` em pt-BR.
- Sem rollback de SRS (sem undo) nesta sessão — cada frase é apresentada uma única vez.

---

## Análise de Design (decisões e porquês)

**D1. Reaproveitar `practice_sessions` + `flashcards` + `flashcard_attempts` (não criar tabelas novas).**
Cada item da sessão é uma frase-alvo com tradução de referência — exatamente a forma de um card. As tabelas já têm FKs, índices únicos de idempotência (`0005`), RLS e telemetria. Os fluxos de flashcards ficam intocados: todas as funções deles filtram `type === "flashcards"`, então sessões `new_words` não vazam para lá (verificado em `getActiveFlashcardPractice`, `persistFlashcardAttempt`, `completeFlashcardPractice`). Custo: uma migration só para estender 3 check constraints + 1 coluna.

**D2. Palavras novas são criadas no banco (`words` + sentido primário) no início da sessão, não no fim.**
Os cards (`flashcards.target_word_id`) e as tentativas (`word_id`/`sense_id`) exigem FKs reais. Se a sessão for abandonada, as palavras permanecem como "novas" no banco — coerente com o SRS (o usuário já as viu; `isNewWord` passa a false só após a primeira revisão aplicada, e a fila diária pode reforçá-las depois). Criação idempotente pelo índice único de `canonical_key` (mesmo padrão catch-and-refetch de `persistSelectedVocabulary`).

**D3. Seleção das palavras novas: IA propõe, validação determinística filtra.**
Prompt recebe nível, idioma e uma amostra do vocabulário conhecido (lemma + traduções) e devolve `[{lemma, translation, part_of_speech}]`. `validateProposedWords` rejeita: stopwords, palavras já no banco (lemma, display_text e formas normalizadas), duplicatas e itens sem tradução. 2 tentativas; falhou → `LearningStateError` 502 (sem fallback de lista frequencial — YAGNI).

**D4. Geração de frases: 1 chamada de IA para a sessão inteira (até 24 frases), validação determinística, retry 1×.**
Mesmo formato de `generatePhrases`/`validateGeneratedPhrases`: 2–6 palavras lexicais por frase, palavra-alvo exatamente 1×, no máximo 1 token lexical fora do vocabulário (escapatória para flexões: "went" para "go"), sem frases duplicadas, tradução obrigatória. Palavra que sobrar sem nenhuma frase válida é descartada da sessão (fica no banco como "nova"; evento registra o descarte).

**D5. Julgamento da tradução: IA por tentativa com fallback determinístico.**
Uma chamada por frase (temperature 0.2, JSON, timeout 12s) recebendo frase, tradução de referência, palavra + sentidos cadastrados e a tradução do aluno; devolve `{verdict, feedback, corrected_translation, new_sense_translation}`. Verdicts mapeiam para `match_result` existente: `correct→exact`, `acceptable→acceptable`, `minor_error→minor_error`, `incorrect→incorrect`. Se a IA falhar, `compareFlashcardAnswer` decide e o feedback é canned — a sessão nunca trava. O `judgment` completo é persistido em `flashcard_attempts.judgment_json` (coluna nova), o que torna o retry idempotente sem re-chamar a IA.

**D6. Expansão de significados = `createWordSense` com `source: "session"`.**
Quando o veredito é `correct`/`acceptable` e a IA devolve `new_sense_translation` (tradução do aluno válida, diferente das cadastradas), cria sentido não-primário com `sense_order` seguinte, `example_sentence` = a frase da sessão, dedupe por `matchesCanonicalSenseKey` + tradução normalizada (mesmo esquema anti-falso-positivo do chat em `vocabulary-selection.ts:664`). `createWordSense` já é idempotente (conflito de `sense_key` → re-read).

**D7. SRS: revisão aplicada incrementalmente no sentido primário da palavra nova.**
Cada frase julgada aplica `{rating, responseTimeMs}` via `applyReviewToSense` (exportada de `flashcards.ts`) — mesma rota dos cards com sentido congelado, incluindo re-agregação do cache da word. `cardType: "target_to_native"` na inferência de rating (compreensão alvo→nativo é o mesmo tipo cognitivo). Sem botões difícil/fácil: `final_rating = inferRecallRating(...)`.

**D8. Fila linear, retomável.**
Ordem = `initial_position` (palavra 1 frases 1–3, palavra 2 frases 1–3, ...). Sem re-apresentação (cada frase 1×). Retomada = primeira frase sem tentativa. Um único bloqueio: só existe 1 sessão `new_words` ativa por usuário/perfil (409 com opção de retomar, como flashcards).

**D9. Áudio: um `<audio>` dedicado destravado no gesto "Começar"; autoplay por frase com fallback visível.**
No clique de iniciar (gesto), `unlockAudioForPlayback(audioRef)`; a cada frase, `requestSpeech(sentence, languageCode)` → `audio.src` → `play()`. Se o play for rejeitado (ex.: retomada sem gesto), estado `audioFailed` mostra `VoiceButton` de replay/replay-lento (mesma UX de fallback dos cards de escuta). Falhas de síntese reportam `voice_kokoro_failure` (helper existente).

**D10. Entrada na UI: seção nova na tela de treino (`/palavras/treino`) linkando `/palavras/novas`.**
O `FlashcardTrainer` recebe apenas um link/botão no intro (mudança mínima, sem risco de regressão); o treino novo tem componente próprio `NewWordsTrainer` (uma responsabilidade por arquivo, como os demais componentes).

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0007_new_words_session.sql` | Estende checks de `practice_sessions.type`, `flashcards.card_type`, `word_senses.source`; adiciona `flashcard_attempts.judgment_json` |
| `lib/learning/new-words-contracts.ts` | Tipos e constantes (tamanhos 3/5/8, vereditos, `NewWordsSentence`, `JudgedTranslation`, resultado) |
| `lib/learning/sentence-validation.ts` | Helpers de frase movidos de `flashcards.ts` (compartilhados, re-exportados) |
| `lib/learning/new-words-validation.ts` | Puro: `validateProposedWords`, `validateGeneratedSentences`, `mapVerdictToMatch`, `fallbackJudgment` |
| `lib/learning/new-words.ts` | Server-only: criar/retomar/abandonar sessão, julgar tentativa, concluir |
| `lib/learning/conversations.ts` | `WordSenseFields.source` ganha `"session"`; `FlashcardAttemptFields.judgment_json` |
| `lib/learning/feedback.ts` | `addSavedWordsToDailyFeedback` delega para `addLearnedWordsToDailyFeedback(userId, profileId, date, count)` |
| `app/api/practice/new-words/route.ts` | GET (sessão ativa) / POST (criar) |
| `app/api/practice/new-words/judge/route.ts` | POST julgar tradução |
| `app/api/practice/new-words/complete/route.ts` | POST concluir |
| `app/api/practice/new-words/abandon/route.ts` | POST abandonar |
| `lib/api/rate-limit.ts` | Regras `new-words-create` (6/min) e `new-words-judge` (30/min) |
| `components/NewWordsTrainer.tsx` | UI completa da sessão (escolha 3/5/8, frases, feedback do professor, resultado) |
| `app/palavras/novas/page.tsx` | Página da sessão (`AppShell` + `NewWordsTrainer`) |
| `components/FlashcardTrainer.tsx` | Link "Aprender palavras novas" no intro |
| `tests/unit/new-words-*.test.ts` | Testes das validações, geração, julgamento, rotas e schema |

---

### Task 1: Migration 0007 e contratos de tipos

**Files:**
- Create: `supabase/migrations/0007_new_words_session.sql`
- Modify: `lib/learning/conversations.ts` (`WordSenseFields.source`, `FlashcardAttemptFields`)
- Create: `lib/learning/new-words-contracts.ts`
- Test: `tests/unit/new-words-schema-contract.test.ts`

**Interfaces:**
- Produces: tipos `NewWordsSessionSize`, `TranslationVerdict`, `JudgedTranslation`, `NewWordsSentence`, `NewWordPreview`, `NewWordsSessionResult`; constantes `newWordsSessionSizes`, `SENTENCES_PER_WORD`, `NEW_WORDS_SENTENCE_MIN/MAX_WORDS`. Consumidos por todas as tasks seguintes.

- [ ] **Step 1: Escrever o teste de contrato do schema (falha)**

```ts
// tests/unit/new-words-schema-contract.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/0007_new_words_session.sql", "utf8");

describe("new words session schema contract", () => {
  it("extends practice_sessions.type with new_words", () => {
    expect(migration).toMatch(/practice_sessions_type_check/);
    expect(migration).toMatch(/'new_words'/);
  });
  it("extends flashcards.card_type with translation", () => {
    expect(migration).toMatch(/flashcards_card_type_check/);
    expect(migration).toMatch(/'translation'/);
  });
  it("extends word_senses.source with session", () => {
    expect(migration).toMatch(/word_senses_source_check/);
    expect(migration).toMatch(/'session'/);
  });
  it("adds judgment_json to flashcard_attempts", () => {
    expect(migration).toMatch(/add column if not exists judgment_json jsonb/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-schema` → FAIL (arquivo não existe).

- [ ] **Step 3: Criar a migration**

```sql
-- supabase/migrations/0007_new_words_session.sql
-- Sessão "palavras novas": novos valores em checks existentes + campo de
-- julgamento da IA por tentativa. Idempotente.

alter table public.practice_sessions drop constraint if exists practice_sessions_type_check;
alter table public.practice_sessions add constraint practice_sessions_type_check
  check (type is null or type = any (array['conversation', 'flashcards', 'weak_words', 'calendar_focus', 'recurring_error', 'new_words']));

alter table public.flashcards drop constraint if exists flashcards_card_type_check;
alter table public.flashcards add constraint flashcards_card_type_check
  check (card_type is null or card_type = any (array['target_to_native', 'native_to_target', 'cloze', 'listening', 'translation']));

alter table public.word_senses drop constraint if exists word_senses_source_check;
alter table public.word_senses add constraint word_senses_source_check
  check (source is null or source = any (array['chat', 'manual', 'backfill', 'session']));

alter table public.flashcard_attempts add column if not exists judgment_json jsonb;
```

- [ ] **Step 4: Atualizar tipos em `lib/learning/conversations.ts`**

Em `WordSenseFields`, trocar a linha do `source`:

```ts
  source?: "chat" | "manual" | "backfill" | "session";
```

Em `FlashcardAttemptFields`, adicionar após `review_snapshot?`:

```ts
  judgment_json?: string;
```

- [ ] **Step 5: Criar `lib/learning/new-words-contracts.ts`**

```ts
export const newWordsSessionSizes = [3, 5, 8] as const;
export type NewWordsSessionSize = (typeof newWordsSessionSizes)[number];

/** Frases por palavra nova. */
export const SENTENCES_PER_WORD = 3;
/** Limites de palavras lexicais por frase (spec: 2 a 6 palavras totais). */
export const NEW_WORDS_SENTENCE_MIN_WORDS = 2;
export const NEW_WORDS_SENTENCE_MAX_WORDS = 6;

export type TranslationVerdict = "correct" | "acceptable" | "minor_error" | "incorrect";

export type JudgedTranslation = {
  verdict: TranslationVerdict;
  /** Feedback do professor, em pt-BR (1–3 frases). */
  feedback: string;
  /** Tradução de referência (pode ser a do banco ou a correção da IA). */
  correctedTranslation: string;
  /** Tradução do aluno validada como sentido novo; ausente quando não há. */
  newSenseTranslation?: string;
};

export type NewWordPreview = {
  wordId: string;
  senseId: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
};

export type NewWordsSentence = {
  id: string;
  sessionId: string;
  targetWordId: string;
  targetSenseId: string;
  /** Frase no idioma alvo (o que o usuário vê e ouve). */
  sentence: string;
  /** Tradução de referência em pt-BR. */
  translation: string;
  audioText: string;
  position: number;
};

export type NewWordsAttemptResult = {
  sentenceId: string;
  clientAttemptId: string;
  judgment: JudgedTranslation;
  rating: "forgot" | "hard" | "good" | "easy";
  senseCreated: boolean;
};

export type NewWordsSessionResult = {
  score: number;
  wordCount: number;
  sentenceCount: number;
  correctSentences: number;
  firstAttemptCorrect: number;
  newSensesAdded: number;
  durationSeconds: number;
  words: NewWordPreview[];
};

export function normalizeNewWordsSessionSize(value: unknown): NewWordsSessionSize {
  return (newWordsSessionSizes as readonly unknown[]).includes(value) ? (value as NewWordsSessionSize) : 3;
}
```

- [ ] **Step 6: Rodar testes e typecheck** — `npm run test:unit -- new-words-schema` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0007_new_words_session.sql lib/learning/conversations.ts lib/learning/new-words-contracts.ts tests/unit/new-words-schema-contract.test.ts
git commit -m "feat: migration e contratos da sessão de palavras novas"
```

---

### Task 2: Extrair helpers de validação de frase (`sentence-validation.ts`)

Move de `flashcards.ts` os helpers puros de frase para um módulo compartilhado (DRY), mantendo compatibilidade via re-export.

**Files:**
- Create: `lib/learning/sentence-validation.ts`
- Modify: `lib/learning/flashcards.ts` (remover definições, importar e re-exportar)
- Test: nenhum novo (os testes existentes de `flashcards`/`flashcard-generation-fallback` garantem o comportamento)

**Interfaces:**
- Produces: `countLexicalWords`, `lexicalTokens`, `allowedFunctionWords`, `targetOccurrenceCount`, `replaceTargetWithBlank`, `escapeRegExp` (todos já usados por `flashcards.ts`; Task 4 consome os 4 primeiros + `targetOccurrenceCount`).

- [ ] **Step 1: Criar `lib/learning/sentence-validation.ts`**

Mover de `flashcards.ts` (linhas ~978–983) exatamente estas definições, sem mudar corpo:

```ts
export function targetOccurrenceCount(sentence: string, target: string) { return [...sentence.matchAll(new RegExp(`(^|\\s|[.,;:!?¿¡])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡])`, "giu"))].length; }
export function replaceTargetWithBlank(sentence: string, target: string) { return sentence.replace(new RegExp(`(^|\\s|[.,;:!?¿¡])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡])`, "iu"), (_match, prefix: string) => `${prefix}___`); }
export function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function countLexicalWords(value: string) { return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0; }
export function lexicalTokens(value: string) { return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).map((token) => token.normalize("NFC")); }
export const allowedFunctionWords = new Set("a an the to of in on at for with and or but i you he she it we they my your his her our their am is are was were be been do does did have has had o os as um uma uns umas de da do das dos em no na nos nas para por com e ou mas eu você ele ela nós vocês eles elas meu minha seu sua el la los las un una unos unas de del al en por para con y o pero yo tú usted él ella nosotros ustedes ellos ellas mi tu su es son era fue ser estar ha han haber".split(" "));
```

- [ ] **Step 2: Atualizar `flashcards.ts`**

Remover as definições movidas e adicionar no topo:

```ts
import { allowedFunctionWords, countLexicalWords, escapeRegExp, lexicalTokens, replaceTargetWithBlank, targetOccurrenceCount } from "./sentence-validation";
export { allowedFunctionWords, countLexicalWords, escapeRegExp, lexicalTokens, replaceTargetWithBlank, targetOccurrenceCount };
```

- [ ] **Step 3: Rodar a suíte existente** — `npm run test:unit` → toda PASS (nenhum comportamento mudou); `npm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/learning/sentence-validation.ts lib/learning/flashcards.ts
git commit -m "refactor: extrai validação de frases para módulo compartilhado"
```

---

### Task 3: Validação de palavras propostas pela IA

**Files:**
- Create: `lib/learning/new-words-validation.ts`
- Test: `tests/unit/new-words-validation.test.ts`

**Interfaces:**
- Consumes: `normalizeVocabularyToken` (`vocabulary-selection.ts`, já exportada), `isVocabularyStopword`, `parseVocabularyForms`.
- Produces: `validateProposedWords(items: unknown, existingWords: ExistingBankWord[], count: number): ProposedWord[]` e `type ProposedWord = { lemma: string; translation: string; partOfSpeech: string }`, `type ExistingBankWord = { lemma: string; displayText: string; formsJson?: string }`.

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-validation.test.ts
import { describe, expect, it } from "vitest";
import { validateProposedWords } from "../../lib/learning/new-words-validation";

const bank = [
  { lemma: "apple", displayText: "apple", formsJson: '["apples"]' },
  { lemma: "go", displayText: "go", formsJson: '["went","gone"]' }
];

describe("validateProposedWords", () => {
  it("aceita palavras inéditas com tradução", () => {
    const words = validateProposedWords(
      [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }],
      bank, 3
    );
    expect(words).toEqual([{ lemma: "bread", translation: "pão", partOfSpeech: "noun" }]);
  });

  it("rejeita palavra que já existe no banco (lemma, display ou forma)", () => {
    const words = validateProposedWords(
      [
        { lemma: "apple", translation: "maçã", part_of_speech: "noun" },
        { lemma: "went", translation: "foi", part_of_speech: "verb" },
        { lemma: "APPLES", translation: "maçãs", part_of_speech: "noun" },
        { lemma: "bread", translation: "pão", part_of_speech: "noun" }
      ],
      bank, 3
    );
    expect(words).toHaveLength(1);
    expect(words[0].lemma).toBe("bread");
  });

  it("rejeita stopword, sem tradução, duplicata e formato inválido", () => {
    const words = validateProposedWords(
      [
        { lemma: "the", translation: "o", part_of_speech: "article" },
        { lemma: "water", translation: "  ", part_of_speech: "noun" },
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        "lixo",
        { lemma: "", translation: "vazio" }
      ],
      bank, 5
    );
    expect(words.map((word) => word.lemma)).toEqual(["milk"]);
  });

  it("retorna no máximo `count` palavras", () => {
    const input = Array.from({ length: 10 }, (_, index) => ({ lemma: `word${index}`, translation: `p${index}`, part_of_speech: "noun" }));
    expect(validateProposedWords(input, bank, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-validation` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/learning/new-words-validation.ts
import { isVocabularyStopword, normalizeVocabularyToken, parseVocabularyForms } from "./vocabulary-selection";

export type ProposedWord = { lemma: string; translation: string; partOfSpeech: string };
export type ExistingBankWord = { lemma: string; displayText: string; formsJson?: string };

/**
 * Filtra a proposta da IA: sem palavras do banco (lemma/display/formas),
 * sem stopwords, sem duplicatas e sempre com tradução. `count` limita o
 * tamanho da sessão (3/5/8).
 */
export function validateProposedWords(items: unknown, existingWords: ExistingBankWord[], count: number): ProposedWord[] {
  if (!Array.isArray(items) || count < 1) return [];
  const taken = new Set(existingWords.flatMap((word) => [
    normalizeVocabularyToken(word.lemma || word.displayText),
    normalizeVocabularyToken(word.displayText),
    ...parseVocabularyForms(word.formsJson).map(normalizeVocabularyToken)
  ].filter(Boolean)));
  const result: ProposedWord[] = [];
  for (const item of items) {
    if (result.length >= count) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const lemma = typeof record.lemma === "string" ? record.lemma.trim() : "";
    const translation = typeof record.translation === "string" ? record.translation.trim() : "";
    if (!lemma || !translation) continue;
    const normalized = normalizeVocabularyToken(lemma);
    if (!normalized || taken.has(normalized) || isVocabularyStopword(lemma, "")) continue;
    taken.add(normalized);
    result.push({
      lemma,
      translation: translation.slice(0, 200),
      partOfSpeech: typeof record.part_of_speech === "string" ? record.part_of_speech.trim().slice(0, 60) : ""
    });
  }
  return result;
}
```

- [ ] **Step 4: Rodar** — `npm run test:unit -- new-words-validation` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words-validation.ts tests/unit/new-words-validation.test.ts
git commit -m "feat: validação das palavras novas propostas pela IA"
```

---

### Task 4: Geração e validação das frases da sessão

**Files:**
- Modify: `lib/learning/new-words-validation.ts`
- Test: `tests/unit/new-words-sentence-validation.test.ts`

**Interfaces:**
- Consumes: `countLexicalWords`, `lexicalTokens`, `allowedFunctionWords`, `targetOccurrenceCount` (Task 2); `NEW_WORDS_SENTENCE_*`, `SENTENCES_PER_WORD` (Task 1).
- Produces: `validateGeneratedSentences(items: unknown, newWords: Array<{ id: string; lemma: string }>, knownWords: string[]): { sentencesByWord: Map<string, GeneratedSentence>; droppedWordIds: string[]; rejectionReasons: Record<string, number> }` com `type GeneratedSentence = { text: string; translation: string }`.

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-sentence-validation.test.ts
import { describe, expect, it } from "vitest";
import { validateGeneratedSentences } from "../../lib/learning/new-words-validation";

const newWords = [{ id: "w1", lemma: "bread" }];
const known = ["eat", "i", "good", "want", "to"];

describe("validateGeneratedSentences", () => {
  it("aceita frases válidas de 2 a 6 palavras com o alvo uma vez", () => {
    const { sentencesByWord, droppedWordIds } = validateGeneratedSentences(
      [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ],
      newWords, known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(3);
    expect(droppedWordIds).toEqual([]);
  });

  it("rejeita frase longa, sem o alvo, com alvo duplicado e com desconhecidas demais", () => {
    const { sentencesByWord, rejectionReasons } = validateGeneratedSentences(
      [
        { text: "I want to eat fresh bread today now", translation: "x", word: "bread" }, // 7 palavras lexicais
        { text: "I eat rice", translation: "x", word: "bread" },                          // alvo ausente
        { text: "bread bread is good", translation: "x", word: "bread" },                 // alvo 2x
        { text: "bread zoqubit merval", translation: "x", word: "bread" },                // 2 desconhecidas
        { text: "bread is good", translation: "pão é bom", word: "bread" }                // válida
      ],
      newWords, known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(1);
    expect(rejectionReasons.too_many_words).toBe(1);
    expect(rejectionReasons.target_occurrences).toBe(2);
    expect(rejectionReasons.unknown_words).toBe(1);
  });

  it("descarta palavra que ficou sem frases e ignora palavra desconhecida da IA", () => {
    const { sentencesByWord, droppedWordIds } = validateGeneratedSentences(
      [{ text: "bread is good", translation: "pão é bom", word: "bread" }],
      [{ id: "w1", lemma: "bread" }, { id: "w2", lemma: "urgent" }],
      known
    );
    expect(sentencesByWord.get("w1")).toHaveLength(1);
    expect(droppedWordIds).toEqual(["w2"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-sentence` → FAIL.

- [ ] **Step 3: Implementar em `new-words-validation.ts`**

```ts
import { NEW_WORDS_SENTENCE_MAX_WORDS, NEW_WORDS_SENTENCE_MIN_WORDS, SENTENCES_PER_WORD } from "./new-words-contracts";
import { allowedFunctionWords, countLexicalWords, lexicalTokens, targetOccurrenceCount } from "./sentence-validation";

export type GeneratedSentence = { text: string; translation: string };

/**
 * Valida as frases geradas pela IA contra o repertório do aluno: tamanho
 * 2–6 palavras lexicais, alvo presente exatamente 1×, no máximo 1 token
 * lexical fora do vocabulário conhecido + function words (escapatória para
 * flexões), sem duplicatas, no máximo SENTENCES_PER_WORD por palavra.
 */
export function validateGeneratedSentences(
  items: unknown,
  newWords: Array<{ id: string; lemma: string }>,
  knownWords: string[]
) {
  const sentencesByWord = new Map<string, GeneratedSentence[]>();
  const droppedWordIds: string[] = [];
  const rejectionReasons: Record<string, number> = {};
  const reject = (reason: string) => { rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1; };
  if (!Array.isArray(items)) return { sentencesByWord, droppedWordIds, rejectionReasons };

  const knownTokens = new Set(knownWords.flatMap((word) => lexicalTokens(word)));
  const targetByLemma = new Map(newWords.map((word) => [normalizeVocabularyTokenSafe(word.lemma), word]));
  const seenSentences = new Set<string>();
  const perWordCount = new Map<string, number>();

  for (const item of items) {
    if (!item || typeof item !== "object") { reject("invalid_shape"); continue; }
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const translation = typeof record.translation === "string" ? record.translation.trim() : "";
    const lemma = typeof record.word === "string" ? normalizeVocabularyTokenSafe(record.word) : "";
    const target = targetByLemma.get(lemma);
    if (!text || !translation || !target) { reject("invalid_shape"); continue; }
    const lexicalCount = countLexicalWords(text);
    if (lexicalCount < NEW_WORDS_SENTENCE_MIN_WORDS || lexicalCount > NEW_WORDS_SENTENCE_MAX_WORDS) { reject("too_many_words"); continue; }
    if (/```|https?:\/\/|\b(?:json|translation)\b/iu.test(text)) { reject("technical_tokens"); continue; }
    if (targetOccurrenceCount(text, target.lemma) !== 1) { reject("target_occurrences"); continue; }
    const targetTokens = new Set(lexicalTokens(target.lemma));
    const unknown = lexicalTokens(text).filter((token) =>
      !knownTokens.has(token) && !targetTokens.has(token) && !allowedFunctionWords.has(token)
    );
    if (new Set(unknown).size > 1) { reject("unknown_words"); continue; }
    const normalizedSentence = text.toLocaleLowerCase();
    if (seenSentences.has(normalizedSentence)) { reject("duplicate"); continue; }
    if ((perWordCount.get(target.id) ?? 0) >= SENTENCES_PER_WORD) { reject("too_many_per_word"); continue; }
    seenSentences.add(normalizedSentence);
    perWordCount.set(target.id, (perWordCount.get(target.id) ?? 0) + 1);
    sentencesByWord.set(target.id, [...(sentencesByWord.get(target.id) ?? []), { text, translation }]);
  }
  for (const word of newWords) {
    if (!sentencesByWord.get(word.id)?.length) droppedWordIds.push(word.id);
  }
  return { sentencesByWord, droppedWordIds, rejectionReasons };
}

function normalizeVocabularyTokenSafe(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}
```

- [ ] **Step 4: Rodar** — `npm run test:unit -- new-words` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words-validation.ts tests/unit/new-words-sentence-validation.test.ts
git commit -m "feat: validação das frases geradas para a sessão de palavras novas"
```

---

### Task 5: Mapeamento de veredito e julgamento fallback

**Files:**
- Modify: `lib/learning/new-words-validation.ts`
- Test: `tests/unit/new-words-judgment.test.ts`

**Interfaces:**
- Produces:
  - `mapVerdictToMatch(verdict: TranslationVerdict): AnswerMatch` (`correct→exact`, `acceptable→acceptable`, `minor_error→minor_error`, `incorrect→incorrect`)
  - `sanitizeJudgment(value: unknown, referenceTranslation: string): JudgedTranslation | null`
  - `fallbackJudgment(userTranslation: string, referenceTranslation: string): JudgedTranslation` (usa `compareFlashcardAnswer`)

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-judgment.test.ts
import { describe, expect, it } from "vitest";
import { fallbackJudgment, mapVerdictToMatch, sanitizeJudgment } from "../../lib/learning/new-words-validation";

describe("julgamento de tradução", () => {
  it("mapeia vereditos para match_result", () => {
    expect(mapVerdictToMatch("correct")).toBe("exact");
    expect(mapVerdictToMatch("acceptable")).toBe("acceptable");
    expect(mapVerdictToMatch("minor_error")).toBe("minor_error");
    expect(mapVerdictToMatch("incorrect")).toBe("incorrect");
  });

  it("sanitiza julgamento da IA e limita tamanho do feedback", () => {
    const judgment = sanitizeJudgment(
      { verdict: "acceptable", feedback: "  Também está certo!  ".repeat(20), corrected_translation: "eu como pão", new_sense_translation: "pão francês" },
      "eu como pão"
    );
    expect(judgment?.verdict).toBe("acceptable");
    expect(judgment?.feedback.startsWith("Também")).toBe(true);
    expect(judgment!.feedback.length).toBeLessThanOrEqual(300);
    expect(judgment?.newSenseTranslation).toBe("pão francês");
  });

  it("descarta julgamento malformado", () => {
    expect(sanitizeJudgment({ verdict: "otimo" }, "x")).toBeNull();
    expect(sanitizeJudgment(null, "x")).toBeNull();
  });

  it("fallback determinístico aceita tradução igual e rejeita diferente", () => {
    expect(fallbackJudgment("Eu como pão.", "eu como pão").verdict).toBe("correct");
    expect(fallbackJudgment("não sei", "eu como pão").verdict).toBe("incorrect");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-judgment` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// acrescentar imports no topo do arquivo
import type { AnswerMatch } from "./flashcard-contracts";
import { compareFlashcardAnswer } from "./flashcard-answer";
import type { JudgedTranslation, TranslationVerdict } from "./new-words-contracts";

const translationVerdicts: TranslationVerdict[] = ["correct", "acceptable", "minor_error", "incorrect"];

export function mapVerdictToMatch(verdict: TranslationVerdict): AnswerMatch {
  if (verdict === "correct") return "exact";
  return verdict;
}

export function sanitizeJudgment(value: unknown, referenceTranslation: string): JudgedTranslation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const verdict = translationVerdicts.find((candidate) => candidate === record.verdict);
  if (!verdict) return null;
  const rawFeedback = typeof record.feedback === "string" ? record.feedback.trim() : "";
  const corrected = typeof record.corrected_translation === "string" && record.corrected_translation.trim()
    ? record.corrected_translation.trim()
    : referenceTranslation;
  const newSense = typeof record.new_sense_translation === "string" && record.new_sense_translation.trim()
    ? record.new_sense_translation.trim().slice(0, 200)
    : undefined;
  return {
    verdict,
    feedback: (rawFeedback || feedbackFallback(verdict)).slice(0, 300),
    correctedTranslation: corrected,
    // Sentido novo só faz sentido quando o aluno acertou.
    ...(verdict === "correct" || verdict === "acceptable" ? { newSenseTranslation: newSense } : {})
  };
}

function feedbackFallback(verdict: TranslationVerdict) {
  if (verdict === "incorrect") return "Ainda não é essa a tradução. Veja a tradução esperada e vamos para a próxima.";
  if (verdict === "minor_error") return "Quase isso! Confira os detalhes na tradução esperada.";
  return "Isso mesmo!";
}

export function fallbackJudgment(userTranslation: string, referenceTranslation: string): JudgedTranslation {
  const match = compareFlashcardAnswer(
    { expectedAnswer: referenceTranslation, acceptedAnswers: [] } as never,
    userTranslation
  );
  const verdict: TranslationVerdict = match === "exact" || match === "acceptable" ? "correct"
    : match === "minor_error" ? "minor_error"
    : "incorrect";
  return { verdict, feedback: feedbackFallback(verdict), correctedTranslation: referenceTranslation };
}
```

> Nota: `compareFlashcardAnswer(input, expected, acceptedAnswers)` recebe primitivos — no `fallbackJudgment` acima use diretamente `const match = compareFlashcardAnswer(userTranslation, referenceTranslation);` e descarte o objeto com cast `as never`.

- [ ] **Step 4: Rodar** — `npm run test:unit -- new-words-judgment` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words-validation.ts tests/unit/new-words-judgment.test.ts
git commit -m "feat: mapeamento e fallback do julgamento de tradução"
```

---

### Task 6: Criar/retomar/abandonar a sessão (server)

**Files:**
- Create: `lib/learning/new-words.ts`
- Test: `tests/unit/new-words-session.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–5; `createChatCompletion`; `getTeableClient`, `TeableRecord`, `TeableRequestError`; `getSessionUser`, `getActiveLanguageProfile`; `LearningStateError`; `canonicalVocabularyKey`, `WordFields`, `WordSenseFields`; `canonicalSenseKey`, `createWordSense`, `nextSenseOrderFromList`, `updateWordSense`; `applyReviewToSense` **(nova export de `flashcards.ts`)**; `flashcardToRecord` de formato adaptado (usa `FlashcardFields` direto).
- Produces:
  - `createNewWordsPractice(input: { count?: unknown }): Promise<{ sessionId: string; sentences: NewWordsSentence[]; words: NewWordPreview[]; languageCode: string; languageName: string }>`
  - `getActiveNewWordsPractice(): Promise<(resumo de sessão ativa) | null>`
  - `abandonNewWordsPractice(sessionId: string): Promise<{ sessionId: string; status: "abandoned" }>`

- [ ] **Step 1: Exportar `applyReviewToSense` de `flashcards.ts`** — trocar `async function applyReviewToSense(` por `export async function applyReviewToSense(`.

- [ ] **Step 2: Escrever o teste do prompt/geração com IA mockada (falha)**

```ts
// tests/unit/new-words-session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion, client } = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
  client: {
    records: new Map<string, { id: string; fields: Record<string, unknown> }>(),
    seq: 0,
    reset() { this.records.clear(); this.seq = 0; },
    async createRecord(table: string, fields: Record<string, unknown>) {
      const id = `${table}-${++this.seq}`;
      this.records.set(id, { id, fields });
      return { id, fields };
    },
    async updateRecord(_table: string, id: string, fields: Record<string, unknown>) {
      const record = this.records.get(id);
      if (!record) throw new Error("not found");
      Object.assign(record.fields, fields);
      return record;
    },
    async listRecordsWhereAll() { return [...this.records.values()] as never; },
    async listRecords() { return [] as never; },
    async listRecordsWhere(_table: string, field: string, value: string) {
      return [...this.records.values()].filter((record) => record.fields[field] === value) as never;
    },
    async createEvent() {}
  }
}));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({ getTeableClient: () => client, TeableRequestError: class extends Error { status = 409; } }));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

import { validateGeneratedSentences } from "../../lib/learning/new-words-validation";

describe("geração de frases para palavras novas", () => {
  beforeEach(() => client.reset());

  it("usa somente frases validadas e respeita retries", async () => {
    const { generateNewWordSentences } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [{ text: "resposta lixo", translation: "x", word: "bread" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) });
    const result = await generateNewWordSentences([{ id: "w1", lemma: "bread" }], ["eat", "good", "want"], "Inglês", "B1");
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.sentencesByWord.get("w1")).toHaveLength(3);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("valida saída com validateGeneratedSentences (contrato compartilhado)", () => {
    const { sentencesByWord } = validateGeneratedSentences(
      [{ text: "bread is good", translation: "pão é bom", word: "bread" }],
      [{ id: "w1", lemma: "bread" }], ["good"]
    );
    expect(sentencesByWord.get("w1")?.[0].translation).toBe("pão é bom");
  });
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npm run test:unit -- new-words-session` → FAIL.

- [ ] **Step 4: Implementar `lib/learning/new-words.ts`**

```ts
import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/supabase/client";
import { LearningStateError } from "./access";
import { WordFields, WordSenseFields } from "./conversations";
import { getActiveLanguageProfile, getSessionUser } from "./profile";
import { canonicalVocabularyKey, normalizeVocabularyToken } from "./vocabulary-selection";
import { canonicalSenseKey, createWordSense, nextSenseOrderFromList } from "./word-senses";
import { type FlashcardAttemptFields, type FlashcardFields, type PracticeSessionFields } from "./flashcards";
import {
  normalizeNewWordsSessionSize,
  type NewWordPreview,
  type NewWordsSentence
} from "./new-words-contracts";
import { validateGeneratedSentences, validateProposedWords, type ExistingBankWord, type GeneratedSentence } from "./new-words-validation";

export type { FlashcardFields, PracticeSessionFields };

const SESSION_TYPE = "new_words";
const MAX_KNOWN_VOCABULARY_IN_PROMPT = 150;

// ---------- Seleção das palavras novas ----------

export async function generateNewWordProposals(
  knownWords: Array<{ lemma: string; translation: string }>,
  bankWords: ExistingBankWord[],
  count: number,
  language: string,
  level: string
) {
  const request = () => createChatCompletion([
    { role: "system", content: `Você é um professor de ${language}. Escolha ${count} palavras NOVAS, úteis e concretas, adequadas ao nível informado, que o aluno ainda não conhece (a lista abaixo é o vocabulário dele). Cada palavra deve ser um lemma no idioma alvo, com tradução em português brasileiro e classe gramatical. Prefira palavras do dia a dia que combinem com o vocabulário que o aluno já tem. Responda somente JSON válido: {"words":[{"lemma":"...","translation":"...","part_of_speech":"noun|verb|adjective|adverb|phrase"}]}.` },
    { role: "user", content: `Idioma: ${language}\nNível: ${level}\nVocabulário atual do aluno: ${JSON.stringify(knownWords)}` }
  ], { temperature: 0.6, maxTokens: 700, timeoutMs: 15_000, responseFormat: "json", disableThinking: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await request();
      const parsed = parseJsonObject(ai.content) as { words?: unknown };
      // A validação contra o banco é determinística: a IA pode propor palavra
      // que o aluno já tem; o filtro descarta e devolve só as inéditas.
      const words = validateProposedWords(parsed.words, bankWords, count);
      if (words.length) return words;
    } catch { /* tenta de novo e depois falha */ }
  }
  throw new LearningStateError("Não foi possível escolher palavras novas agora. Tente novamente em instantes.", 502);
}

// ---------- Geração das frases ----------

export async function generateNewWordSentences(newWords: Array<{ id: string; lemma: string }>, knownLemmas: string[], language: string, level: string) {
  const request = () => createChatCompletion([
    { role: "system", content: `Crie frases curtas de treino de tradução em ${language}, adequadas ao nível informado. Para cada palavra nova, crie exatamente ${SENTENCES_PER_WORD} frases. Regras: cada frase tem de 2 a 6 palavras; usa a palavra nova exatamente uma vez, como fornecida; usa SOMENTE palavras da lista de vocabulário conhecido do aluno, a própria palavra nova e palavras gramaticais muito comuns (artigos, preposições, pronomes, auxiliares); sentido claro e não ambíguo. Responda somente JSON válido: {"sentences":[{"text":"...","translation":"...","word":"lemma-da-palavra-nova"}]}, com translation em português brasileiro.` },
    { role: "user", content: `Nível: ${level}\nPalavras novas: ${JSON.stringify(newWords.map((word) => word.lemma))}\nVocabulário conhecido: ${JSON.stringify(knownLemmas.slice(0, MAX_KNOWN_VOCABULARY_IN_PROMPT))}` }
  ], { temperature: 0.5, maxTokens: 1600, timeoutMs: 20_000, responseFormat: "json", disableThinking: true });
  const emptyResult: ReturnType<typeof validateGeneratedSentences> = {
    sentencesByWord: new Map<string, GeneratedSentence[]>(),
    droppedWordIds: newWords.map((word) => word.id),
    rejectionReasons: {}
  };
  let last = emptyResult;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await request();
      const parsed = parseJsonObject(ai.content) as { sentences?: unknown };
      const validated = validateGeneratedSentences(parsed.sentences, newWords, knownLemmas);
      last = validated;
      if (validated.droppedWordIds.length < newWords.length) return validated;
    } catch { /* tenta de novo e depois devolve o último resultado */ }
  }
  return last;
}

// ---------- Criação da sessão ----------

export async function createNewWordsPractice(input: { count?: unknown }) {
  const count = normalizeNewWordsSessionSize(input.count);
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Configure um idioma antes de iniciar a sessão.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const [allWords, sessions] = await Promise.all([
    client.listRecordsWhereAll<WordFields>("words", scopeFilters),
    client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters)
  ]);
  const active = sessions.find((session) => session.fields.type === SESSION_TYPE && (session.fields.status === "active" || session.fields.status === "preparing"));
  if (active) throw new LearningStateError("Você já possui uma sessão de palavras novas em andamento. Continue-a antes de iniciar outra.", 409);

  const language = profile.fields.language_name || profile.fields.language_code || "Inglês";
  const level = profile.fields.level || "intermediário";
  const bankWords: ExistingBankWord[] = allWords.map((word) => ({
    lemma: word.fields.lemma || "",
    displayText: word.fields.display_text || "",
    formsJson: word.fields.forms_json
  }));
  // Lemma + tradução ajudam a IA a escolher palavras que combinem com o repertório.
  const knownWordsForPrompt = allWords
    .map((word) => ({ lemma: word.fields.display_text || word.fields.lemma || "", translation: word.fields.translation || "" }))
    .filter((word) => word.lemma);

  // 1. IA propõe as palavras novas (validadas deterministicamente contra o banco).
  const proposals = await generateNewWordProposals(knownWordsForPrompt, bankWords, count, language, level);

  // 2. Persiste as palavras + sentido primário (idempotente por canonical_key/sense_key).
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const created: NewWordPreview[] = [];
  for (const proposal of proposals) {
    const canonicalKey = canonicalVocabularyKey(user.id, profile.id, proposal.lemma);
    let word: TeableRecord<WordFields> | undefined = allWords.find((item) => item.fields.canonical_key === canonicalKey);
    if (!word) {
      try {
        word = await client.createRecord<WordFields>("words", {
          Name: proposal.lemma,
          user_id: user.id,
          language_profile_id: profile.id,
          lemma: proposal.lemma,
          canonical_key: canonicalKey,
          display_text: proposal.lemma,
          forms_json: "[]",
          translation: proposal.translation,
          part_of_speech: proposal.partOfSpeech,
          familiarity_score: 1,
          total_uses: 0,
          last_used_at: now,
          first_used_at: now,
          review_due_at: reviewDue
        });
        allWords.push(word);
      } catch (error) {
        if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
        const refreshed = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
        word = refreshed.find((item) => item.fields.canonical_key === canonicalKey);
        if (!word) throw error;
      }
    }
    const existingSenses = (await listSenses(client, word.id));
    let sense = existingSenses.find((item) => item.fields.sense_key === canonicalSenseKey(user.id, profile.id, proposal.lemma, proposal.translation));
    if (!sense) {
      sense = await createWordSense({
        Name: proposal.lemma,
        user_id: user.id,
        word_id: word.id,
        sense_key: canonicalSenseKey(user.id, profile.id, proposal.lemma, proposal.translation),
        translation: proposal.translation,
        part_of_speech: proposal.partOfSpeech || undefined,
        source: "session",
        is_primary: true,
        sense_order: nextSenseOrderFromList(existingSenses),
        total_uses: 0,
        review_due_at: reviewDue,
        review_state: "new",
        created_at: now
      });
    }
    created.push({ wordId: word.id, senseId: sense.id, lemma: proposal.lemma, translation: proposal.translation, partOfSpeech: proposal.partOfSpeech });
  }

  // 3. IA gera as frases (validadas); palavras sem frase nenhuma saem da sessão.
  const knownLemmas = knownWords.map((word) => word.lemma);
  const generation = await generateNewWordSentences(created.map((word) => ({ id: word.wordId, lemma: word.lemma })), knownLemmas, language, level);
  const usable = created.filter((word) => generation.sentencesByWord.get(word.wordId)?.length);
  if (!usable.length) throw new LearningStateError("Não foi possível montar as frases agora. Tente novamente em instantes.", 502);

  // 4. Sessão preparing → cards → active (mesmo ciclo dos flashcards).
  const session = await client.createRecord<PracticeSessionFields>("practiceSessions", {
    Name: `Palavras novas · ${now.slice(0, 10)}`,
    user_id: user.id,
    language_profile_id: profile.id,
    conversation_id: "",
    type: SESSION_TYPE,
    focus: JSON.stringify({ count, wordIds: usable.map((word) => word.wordId) }),
    status: "preparing",
    started_at: now,
    ended_at: "",
    duration_seconds: 0,
    requested_word_count: count,
    selected_word_count: usable.length,
    unique_card_count: 0,
    presentation_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    score: 0,
    language_code: profile.fields.language_code,
    configuration_json: "{}",
    created_at: now,
    updated_at: now
  });

  const sentences: NewWordsSentence[] = [];
  let position = 0;
  for (const word of usable) {
    for (const generated of generation.sentencesByWord.get(word.wordId) ?? []) {
      const record = await client.createRecord<FlashcardFields>("flashcards", {
        user_id: user.id,
        practice_session_id: session.id,
        target_word_id: word.wordId,
        target_sense_id: word.senseId,
        supporting_word_ids: "[]",
        card_type: "translation",
        prompt: generated.text,
        expected_answer: generated.translation,
        accepted_answers: "[]",
        translation: generated.translation,
        explanation: "",
        sentence: generated.text,
        audio_text: generated.text,
        difficulty: 1,
        initial_position: position,
        generation_source: "ai",
        created_at: now
      });
      sentences.push({
        id: record.id,
        sessionId: session.id,
        targetWordId: word.wordId,
        targetSenseId: word.senseId,
        sentence: generated.text,
        translation: generated.translation,
        audioText: generated.text,
        position
      });
      position += 1;
    }
  }

  // Exemplo da primeira frase vira exemplo do sentido primário.
  for (const word of usable) {
    const first = sentences.find((sentence) => sentence.targetWordId === word.wordId);
    if (first) await updateWordSense(word.senseId, { example_sentence: first.sentence }).catch(() => undefined);
  }

  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    status: "active",
    unique_card_count: sentences.length,
    updated_at: new Date().toISOString()
  });
  await client.createEvent(user.id, "new_words_session_started", {
    session_id: session.id,
    requested_count: count,
    word_count: usable.length,
    sentence_count: sentences.length,
    dropped_word_ids: generation.droppedWordIds,
    rejection_reasons: generation.rejectionReasons
  });

  return { sessionId: session.id, sentences, words: usable, languageCode: profile.fields.language_code, languageName: profile.fields.language_name };
}

// ---------- Retomada ----------

export async function getActiveNewWordsPractice() {
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  const session = sessions
    .filter((item) => item.fields.type === SESSION_TYPE && item.fields.status === "active")
    .sort((a, b) => dateValue(b.fields.started_at || b.fields.created_at) - dateValue(a.fields.started_at || a.fields.created_at))[0];
  if (!session) return null;
  const [sentences, attempts] = await Promise.all([
    listSentences(client, user.id, session.id),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "practice_session_id", session.id)
  ]);
  const answeredIds = new Set(attempts.filter((attempt) => !attempt.fields.undone_at).map((attempt) => attempt.fields.flashcard_id));
  const next = sentences.find((sentence) => !answeredIds.has(sentence.id));
  await client.createEvent(user.id, "new_words_session_resumed", { session_id: session.id, answered_count: answeredIds.size });
  return {
    sessionId: session.id,
    sentences,
    answeredCount: answeredIds.size,
    answeredSentenceIds: [...answeredIds],
    nextSentenceId: next?.id ?? "",
    languageCode: session.fields.language_code || profile.fields.language_code,
    languageName: profile.fields.language_name,
    words: await sessionWordPreviews(client, user.id, profile.id, session)
  };
}

export async function abandonNewWordsPractice(sessionId: string) {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão.", 422);
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && (item.fields.status === "active" || item.fields.status === "preparing"));
  if (!session) throw new LearningStateError("Sessão ativa não encontrada.", 404);
  const endedAt = new Date();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    status: "abandoned",
    ended_at: endedAt.toISOString(),
    duration_seconds: Math.max(0, Math.round((endedAt.getTime() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000)),
    updated_at: endedAt.toISOString()
  });
  await client.createEvent(user.id, "new_words_session_abandoned", { session_id: session.id });
  return { sessionId: session.id, status: "abandoned" as const };
}

// ---------- helpers ----------

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) as Record<string, unknown> : {}; } catch { return {}; }
}

function dateValue(value: string | undefined) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }

function listSenses(client: ReturnType<typeof getTeableClient>, wordId: string) {
  return client.listRecordsWhere<WordSenseFields>("wordSenses", "word_id", wordId);
}

function listSentences(client: ReturnType<typeof getTeableClient>, userId: string, sessionId: string): Promise<NewWordsSentence[]> {
  return client.listRecordsWhere<FlashcardFields>("flashcards", "practice_session_id", sessionId).then((records) =>
    records
      .filter((record) => record.fields.user_id === userId && record.fields.card_type === "translation")
      .sort((a, b) => a.fields.initial_position - b.fields.initial_position)
      .map((record) => ({
        id: record.id,
        sessionId,
        targetWordId: record.fields.target_word_id,
        targetSenseId: record.fields.target_sense_id || "",
        sentence: record.fields.sentence || record.fields.prompt,
        translation: record.fields.translation || record.fields.expected_answer,
        audioText: record.fields.audio_text || record.fields.sentence || record.fields.prompt,
        position: record.fields.initial_position
      }))
  );
}

async function sessionWordPreviews(client: ReturnType<typeof getTeableClient>, userId: string, profileId: string, session: TeableRecord<PracticeSessionFields>): Promise<NewWordPreview[]> {
  const focus = parseJsonObject(session.fields.focus ?? "{}") as { wordIds?: unknown };
  const wordIds = Array.isArray(focus.wordIds) ? focus.wordIds.filter((id): id is string => typeof id === "string") : [];
  if (!wordIds.length) return [];
  const words = await client.listRecordsWhereAll<WordFields>("words", [
    { field: "user_id", value: userId },
    { field: "language_profile_id", value: profileId }
  ]);
  const previews: NewWordPreview[] = [];
  for (const wordId of wordIds) {
    const word = words.find((item) => item.id === wordId);
    if (!word) continue;
    const senses = await listSenses(client, wordId);
    const primary = senses.find((item) => item.fields.is_primary) ?? senses[0];
    previews.push({
      wordId,
      senseId: primary?.id ?? "",
      lemma: word.fields.display_text || word.fields.lemma,
      translation: primary?.fields.translation || word.fields.translation || "",
      partOfSpeech: word.fields.part_of_speech || ""
    });
  }
  return previews;
}
```

> Ajustes ao transcrever: importe `FlashcardAttemptFields` de `./flashcards`; `normalizeVocabularyToken` pode substituir o `normalizeVocabularyTokenSafe` local (remova o local e use o importado); garanta que `validateProposedWords` receba o banco como `ExistingBankWord[]` — mapeie `allWords` para `{ lemma, displayText, formsJson }` antes da chamada.

- [ ] **Step 5: Rodar** — `npm run test:unit -- new-words` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/learning/new-words.ts lib/learning/flashcards.ts tests/unit/new-words-session.test.ts
git commit -m "feat: criação, retomada e abandono da sessão de palavras novas"
```

---

### Task 7: Julgar tradução (IA professora + expansão de sentidos + SRS)

**Files:**
- Modify: `lib/learning/new-words.ts`
- Test: `tests/unit/new-words-judge.test.ts`

**Interfaces:**
- Produces: `judgeNewWordsAttempt(input: { sessionId?, clientAttemptId?, sentenceId?, userTranslation?, responseTimeMs?, usedSpeech?, audioReplayCount?, usedSlowAudio?, audioFailed? }): Promise<NewWordsAttemptResult>`

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-judge.test.ts
import { describe, expect, it, vi } from "vitest";

const { createChatCompletion } = vi.hoisted(() => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

import { mapVerdictToMatch } from "../../lib/learning/new-words-validation";

describe("judgeNewWordsAttempt (contratos)", () => {
  it("mapeia veredito correto para match exact e rating via inferRecallRating", async () => {
    const { inferRecallRating } = await import("../../lib/learning/flashcard-queue");
    const rating = inferRecallRating({ match: mapVerdictToMatch("correct"), forgot: false, responseTimeMs: 2500, cardType: "target_to_native" });
    expect(["good", "easy"]).toContain(rating);
  });

  it("veredito incorreto mapeia para rating esquecido", async () => {
    const { inferRecallRating } = await import("../../lib/learning/flashcard-queue");
    const rating = inferRecallRating({ match: mapVerdictToMatch("incorrect"), forgot: false, responseTimeMs: 1000, cardType: "target_to_native" });
    expect(rating).toBe("forgot");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** (o judge ainda não existe; o teste de contratos passa mas o Step 5 adiciona teste de integração do judge — mantenha o arquivo e acrescente:) 

```ts
// acrescentar ao mesmo arquivo
describe("judgeNewWordsAttempt", () => {
  it("recusa tradução vazia", async () => {
    const { judgeNewWordsAttempt } = await import("../../lib/learning/new-words");
    await expect(judgeNewWordsAttempt({ sessionId: "s1", clientAttemptId: "attempt-0001", sentenceId: "c1", userTranslation: "  " })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Implementar em `new-words.ts`**

```ts
// imports adicionais
import { inferRecallRating } from "./flashcard-queue";
import { normalizeFlashcardAnswer, compareFlashcardAnswer } from "./flashcard-answer";
import { applyReviewToSense as applySenseReview } from "./flashcards";
import { listSensesByWordIds, matchesCanonicalSenseKey } from "./word-senses";
import { fallbackJudgment, mapVerdictToMatch, sanitizeJudgment } from "./new-words-validation";
import type { JudgedTranslation } from "./new-words-contracts";

type JudgeInput = {
  sessionId?: unknown; clientAttemptId?: unknown; sentenceId?: unknown; userTranslation?: unknown;
  responseTimeMs?: unknown; usedSpeech?: unknown; audioReplayCount?: unknown; usedSlowAudio?: unknown; audioFailed?: unknown;
};

export async function judgeNewWordsAttempt(input: JudgeInput): Promise<NewWordsAttemptResult> {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const clientAttemptId = typeof input.clientAttemptId === "string" ? input.clientAttemptId : "";
  const sentenceId = typeof input.sentenceId === "string" ? input.sentenceId : "";
  const userTranslation = typeof input.userTranslation === "string" ? input.userTranslation.trim().slice(0, 300) : "";
  if (!sessionId || !isOperationId(clientAttemptId)) throw new LearningStateError("Identificador da tentativa inválido.", 422);
  if (!userTranslation) throw new LearningStateError("Escreva a tradução antes de enviar.", 422);

  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const [sessions, attemptRecords] = await Promise.all([
    client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "user_id", user.id)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && item.fields.status === "active");
  if (!session) throw new LearningStateError("Sessão ativa não encontrada.", 404);

  const sessionAttempts = attemptRecords
    .filter((record) => record.fields.practice_session_id === sessionId && !record.fields.undone_at)
    .sort((a, b) => dateValue(a.fields.created_at || a.createdTime) - dateValue(b.fields.created_at || b.createdTime) || a.id.localeCompare(b.id));

  // Idempotência: mesma clientAttemptId devolve o julgamento persistido.
  const sentences = await listSentences(client, user.id, sessionId);
  const existing = sessionAttempts.find((record) => record.fields.client_attempt_id === clientAttemptId);
  if (existing) {
    const stored = parseJsonObject(existing.fields.judgment_json ?? "") as JudgedTranslation;
    const reference = sentences.find((sentence) => sentence.id === existing.fields.flashcard_id)?.translation ?? "";
    return {
      sentenceId: existing.fields.flashcard_id,
      clientAttemptId,
      judgment: stored && stored.verdict ? stored : fallbackJudgment(userTranslation, reference),
      rating: existing.fields.final_rating,
      senseCreated: false
    };
  }

  const answeredIds = new Set(sessionAttempts.map((record) => record.fields.flashcard_id));
  const next = sentences.find((sentence) => !answeredIds.has(sentence.id));
  if (!next || next.id !== sentenceId) throw new LearningStateError("A tentativa não corresponde à próxima frase da sessão.", 409);

  // Contexto pedagógico: palavra + sentidos cadastrados.
  const words = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
  const word = words.find((item) => item.id === next.targetWordId);
  if (!word) throw new LearningStateError("Palavra da frase não encontrada.", 404);
  const senses = (await listSensesByWordIds([word.id])).get(word.id) ?? [];

  // 1) IA professora; 2) fallback determinístico se a IA falhar.
  let judgment = await requestTeacherJudgment(next, word, senses, userTranslation).catch(() => null) ?? fallbackJudgment(userTranslation, next.translation);
  // Correção determinística tem precedência em acertos óbvios: tradução
  // idêntica à referência é "correct" mesmo se a IA titubeou.
  if (compareFlashcardAnswer(userTranslation, next.translation) === "exact") {
    judgment = { ...judgment, verdict: "correct", correctedTranslation: next.translation };
  }

  // Expansão de significados: tradução válida diferente das cadastradas.
  let senseCreated = false;
  if ((judgment.verdict === "correct" || judgment.verdict === "acceptable") && judgment.newSenseTranslation) {
    senseCreated = await expandWordSense(user.id, profile.id, word, senses, judgment.newSenseTranslation, next.sentence);
    if (senseCreated) {
      await client.createEvent(user.id, "new_words_sense_expanded", {
        session_id: sessionId, word_id: word.id, translation: judgment.newSenseTranslation, sentence: next.sentence
      });
    }
  }

  // Persiste a tentativa + aplica a revisão SRS no sentido primário.
  const matchResult = mapVerdictToMatch(judgment.verdict);
  const responseTimeMs = Math.max(0, Math.min(300_000, Math.round(Number(input.responseTimeMs) || 0)));
  const rating = inferRecallRating({ match: matchResult, forgot: false, responseTimeMs, cardType: "target_to_native" });
  const now = new Date().toISOString();
  const targetSense = senses.find((item) => item.id === next.targetSenseId);
  const record = await client.createRecord<FlashcardAttemptFields>("flashcardAttempts", {
    user_id: user.id,
    practice_session_id: sessionId,
    flashcard_id: next.id,
    word_id: word.id,
    sense_id: next.targetSenseId || "",
    presentation_number: 1,
    client_attempt_id: clientAttemptId,
    user_answer: userTranslation,
    normalized_answer: normalizeFlashcardAnswer(userTranslation),
    match_result: matchResult,
    suggested_rating: rating,
    final_rating: rating,
    was_correct: judgment.verdict === "correct" || judgment.verdict === "acceptable",
    response_time_ms: responseTimeMs,
    used_speech: input.usedSpeech === true,
    audio_replay_count: Math.max(0, Math.min(30, Math.round(Number(input.audioReplayCount) || 0))),
    used_slow_audio: input.usedSlowAudio === true,
    answered_after_audio_replay: Number(input.audioReplayCount) > 0,
    audio_failed: input.audioFailed === true,
    judgment_json: JSON.stringify(judgment),
    created_at: now
  });

  if (targetSense) {
    try {
      await applySenseReview(client, word, targetSense, [{ rating, responseTimeMs, cardType: "target_to_native" }], new Date(now), user.fields.timezone ?? "UTC");
      await client.updateRecord<FlashcardAttemptFields>("flashcardAttempts", record.id, { review_applied: true, resulting_review_state: "" });
    } catch (error) {
      await client.createEvent(user.id, "new_words_review_failed", { session_id: sessionId, sentence_id: next.id, message: error instanceof Error ? error.message : "unknown" }).catch(() => undefined);
    }
  }

  await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, {
    presentation_count: sessionAttempts.length + 1,
    updated_at: now
  });
  await client.createEvent(user.id, "new_words_attempt_judged", {
    session_id: sessionId, sentence_id: next.id, verdict: judgment.verdict, rating, sense_created: senseCreated, response_time_ms: responseTimeMs
  });

  return { sentenceId: next.id, clientAttemptId, judgment, rating, senseCreated };
}

async function requestTeacherJudgment(
  sentence: NewWordsSentence,
  word: TeableRecord<WordFields>,
  senses: TeableRecord<WordSenseFields>[],
  userTranslation: string
): Promise<JudgedTranslation> {
  const knownSenses = senses.map((sense) => sense.fields.translation).filter(Boolean);
  const ai = await createChatCompletion([
    { role: "system", content: [
      "Você é um professor de idiomas gentil e objetivo corrigindo a tradução de uma frase feita por um aluno brasileiro.",
      `Frase no idioma alvo: "${sentence.sentence}".`,
      `Tradução de referência: "${sentence.translation}".`,
      `Palavra-alvo: "${word.fields.display_text || word.fields.lemma}" — significados cadastrados no banco: ${JSON.stringify(knownSenses)}.`,
      "Avalie a tradução do aluno comparando com o significado da palavra-alvo na frase.",
      "Regras:",
      '- verdict "correct": tradução fiel ao sentido da frase (mesmo com palavras diferentes).',
      '- verdict "acceptable": tradução correta na essência, com diferença de registro ou nuance.',
      '- verdict "minor_error": ideia certa, mas com erro pequeno (ortografia/concordância no português).',
      '- verdict "incorrect": sentido errado, incompleto ou não traduz a frase.',
      '- feedback: 1 a 3 frases curtas em português brasileiro, em tom de professor; se correto, elogie e reforce o significado da palavra-alvo.',
      '- corrected_translation: a melhor tradução em português (a de referência ou uma versão melhorada da do aluno).',
      '- new_sense_translation: quando a tradução do aluno estiver certa mas revelar um significado/nuance da palavra-alvo DIFERENTE dos significados cadastrados, informe esse novo significado em português (curto); caso contrário, null.',
      'Responda somente JSON válido: {"verdict":"correct|acceptable|minor_error|incorrect","feedback":"...","corrected_translation":"...","new_sense_translation":null}.'
    ].join("\n") },
    { role: "user", content: `Tradução do aluno: "${userTranslation}"` }
  ], { temperature: 0.2, maxTokens: 320, timeoutMs: 12_000, responseFormat: "json", disableThinking: true });
  const parsed = parseJsonObject(ai.content);
  const judgment = sanitizeJudgment(parsed, sentence.translation);
  if (!judgment) throw new Error("Resposta da IA malformada.");
  return judgment;
}

async function expandWordSense(
  userId: string,
  profileId: string,
  word: TeableRecord<WordFields>,
  senses: TeableRecord<WordSenseFields>[],
  translation: string,
  exampleSentence: string
) {
  const lemma = word.fields.lemma || word.fields.display_text || "";
  const senseKey = canonicalSenseKey(userId, profileId, lemma, translation);
  const normalized = normalizeVocabularyToken(translation);
  const alreadyKnown = senses.some((sense) =>
    matchesCanonicalSenseKey(sense.fields.sense_key, senseKey) ||
    (sense.fields.translation?.trim() && normalizeVocabularyToken(sense.fields.translation) === normalized)
  );
  if (alreadyKnown) return false;
  try {
    await createWordSense({
      Name: lemma,
      user_id: userId,
      word_id: word.id,
      sense_key: senseKey,
      translation,
      part_of_speech: word.fields.part_of_speech || undefined,
      example_sentence: exampleSentence.slice(0, 300),
      source: "session",
      is_primary: false,
      sense_order: nextSenseOrderFromList(senses),
      total_uses: 1,
      review_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      review_state: "new",
      created_at: new Date().toISOString()
    });
    return true;
  } catch {
    return false; // Falha ao expandir não pode travar a sessão.
  }
}

function isOperationId(value: string) { return /^[a-zA-Z0-9_-]{8,100}$/.test(value); }
```

> `SENTENCES_PER_WORD` importado pode não ser usado aqui — remova se o lint reclamar. `compareFlashcardAnswer` com 2 argumentos usa `acceptedAnswers = []` por padrão.

- [ ] **Step 4: Rodar** — `npm run test:unit -- new-words` → PASS; `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words.ts tests/unit/new-words-judge.test.ts
git commit -m "feat: julgamento da tradução pela IA professora com expansão de sentidos"
```

---

### Task 8: Concluir a sessão (resultado + feedback diário)

**Files:**
- Modify: `lib/learning/new-words.ts`
- Modify: `lib/learning/feedback.ts`
- Test: `tests/unit/new-words-complete.test.ts`

**Interfaces:**
- Consumes: `addLearnedWordsToDailyFeedback` (novo, em `feedback.ts`).
- Produces: `completeNewWordsPractice(sessionId: string, clientCompletionId: string): Promise<NewWordsSessionResult>`

- [ ] **Step 1: Refatorar `feedback.ts`** — extrair a lógica de `addSavedWordsToDailyFeedback`:

```ts
export async function addSavedWordsToDailyFeedback(conversation: TeableRecord<ConversationFields>, count: number) {
  return addLearnedWordsToDailyFeedback(
    conversation.fields.user_id,
    conversation.fields.language_profile_id,
    toDateKey(conversation.fields.ended_at || conversation.fields.started_at),
    count
  );
}

/** Incrementa new_words_count do feedback do dia (usado por conversas e pela sessão de palavras novas). */
export async function addLearnedWordsToDailyFeedback(userId: string, profileId: string, dateKey: string, count: number) {
  if (count <= 0) return;
  const client = getTeableClient();
  const feedbacks = await client.listRecords<DailyFeedbackFields>("dailyFeedbacks", 180);
  const feedback = feedbacks.find((item) =>
    item.fields.user_id === userId &&
    item.fields.language_profile_id === profileId &&
    toDateKey(item.fields.date) === dateKey
  );
  if (feedback) {
    await client.updateRecord<DailyFeedbackFields>("dailyFeedbacks", feedback.id, {
      new_words_count: Number(feedback.fields.new_words_count ?? 0) + count
    });
  }
}
```

- [ ] **Step 2: Escrever o teste (falha)** — teste de contratos: conclusão exige todas as frases respondidas e é idempotente por `clientCompletionId`. Modele o client como na Task 6, grave 2 frases + 2 tentativas, chame `completeNewWordsPractice("s1", "complete-0001")` duas vezes e verifique mesmo resultado (score 100, `sentenceCount` 2).

```ts
// tests/unit/new-words-complete.test.ts (esqueleto — siga os mocks da Task 6,
// acrescentando flashcardAttempts e pratiqueSessions nos records do client)
it("conclui com score 100 e é idempotente", async () => {
  const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
  const first = await completeNewWordsPractice("practiceSessions-1", "complete-0001");
  const second = await completeNewWordsPractice("practiceSessions-1", "complete-0001");
  expect(first.score).toBe(100);
  expect(second).toEqual(first);
});
```

- [ ] **Step 3: Implementar em `new-words.ts`**

```ts
const completionLocks = new Map<string, Promise<NewWordsSessionResult>>();

export async function completeNewWordsPractice(sessionId: string, clientCompletionId: string): Promise<NewWordsSessionResult> {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão.", 422);
  if (!isOperationId(clientCompletionId)) throw new LearningStateError("Identificador de conclusão inválido.", 422);
  const pending = completionLocks.get(sessionId);
  if (pending) return pending;
  const operation = completeNewWordsPracticeUnlocked(sessionId, clientCompletionId);
  completionLocks.set(sessionId, operation);
  try { return await operation; } finally { completionLocks.delete(sessionId); }
}

async function completeNewWordsPracticeUnlocked(sessionId: string, clientCompletionId: string): Promise<NewWordsSessionResult> {
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE);
  if (!session) throw new LearningStateError("Sessão não encontrada.", 404);
  const focus = parseJsonObject(session.fields.focus ?? "{}") as Record<string, unknown> & {
    completed?: boolean; completionId?: string; result?: NewWordsSessionResult; expandedSenses?: number;
  };
  if (focus.completed || session.fields.status === "completed") {
    if (focus.completionId === clientCompletionId && focus.result) return focus.result;
    throw new LearningStateError("Esta sessão já foi contabilizada.", 409);
  }
  const [sentences, attempts] = await Promise.all([
    listSentences(client, user.id, sessionId),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "practice_session_id", sessionId)
  ]);
  const liveAttempts = attempts.filter((record) => !record.fields.undone_at);
  const answeredBySentence = new Map<string, typeof liveAttempts[number]>();
  for (const record of liveAttempts.sort((a, b) => dateValue(a.fields.created_at) - dateValue(b.fields.created_at))) {
    answeredBySentence.set(record.fields.flashcard_id, record);
  }
  const pending = sentences.filter((sentence) => !answeredBySentence.has(sentence.id));
  if (pending.length) throw new LearningStateError("Ainda existem frases pendentes nesta sessão.", 409);

  const judgmentOf = (record: typeof liveAttempts[number]) =>
    parseJsonObject(record.fields.judgment_json ?? "") as JudgedTranslation;
  const correctSentences = liveAttempts.filter((record) => record.fields.was_correct).length;
  const firstAttemptCorrect = correctSentences; // cada frase é apresentada uma única vez
  const newSensesAdded = liveAttempts.filter((record) => {
    const judgment = judgmentOf(record);
    return Boolean(judgment.newSenseTranslation) && (judgment.verdict === "correct" || judgment.verdict === "acceptable");
  }).length;
  const score = sentences.length ? Math.round((correctSentences / sentences.length) * 100) : 0;
  const durationSeconds = Math.max(0, Math.round((Date.now() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000));
  const words = await sessionWordPreviews(client, user.id, profile.id, session);
  const result: NewWordsSessionResult = {
    score, wordCount: words.length, sentenceCount: sentences.length,
    correctSentences, firstAttemptCorrect, newSensesAdded, durationSeconds, words
  };

  const endedAt = new Date().toISOString();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    focus: JSON.stringify({ ...focus, completed: true, completionId: clientCompletionId, result, expandedSenses: newSensesAdded }),
    status: "completed",
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    presentation_count: sentences.length,
    correct_count: correctSentences,
    incorrect_count: sentences.length - correctSentences,
    score,
    updated_at: endedAt
  });
  await client.createEvent(user.id, "new_words_session_completed", {
    session_id: sessionId, score, sentence_count: sentences.length, correct: correctSentences, new_senses: newSensesAdded, duration_seconds: durationSeconds
  });
  // Palavras novas contam no feedback do dia (mesma métrica das conversas).
  try {
    await addLearnedWordsToDailyFeedback(user.id, profile.id, toDateKey(new Date().toISOString()), words.length);
  } catch (error) {
    console.warn("new words: daily feedback update failed", error);
  }
  return result;
}
```

> No Step 1, além do refactor mostrado, **exporte** `toDateKey` de `feedback.ts` (hoje é função local) e importe-o em `new-words.ts` junto com `addLearnedWordsToDailyFeedback`.

- [ ] **Step 4: Rodar** — `npm run test:unit` → PASS (inclui os testes existentes de `daily-feedback`, que protegem o refactor); `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words.ts lib/learning/feedback.ts tests/unit/new-words-complete.test.ts
git commit -m "feat: conclusão da sessão de palavras novas com resultado e feedback diário"
```

---

### Task 9: Rotas de API + rate limit

**Files:**
- Create: `app/api/practice/new-words/route.ts`
- Create: `app/api/practice/new-words/judge/route.ts`
- Create: `app/api/practice/new-words/complete/route.ts`
- Create: `app/api/practice/new-words/abandon/route.ts`
- Modify: `lib/api/rate-limit.ts`
- Test: `tests/unit/new-words-api.test.ts`

**Interfaces:**
- Consumes: `createNewWordsPractice`, `getActiveNewWordsPractice`, `judgeNewWordsAttempt`, `completeNewWordsPractice`, `abandonNewWordsPractice`.
- Rotas: `GET /api/practice/new-words` (sessão ativa), `POST` (criar, body `{count}`), `POST .../judge`, `POST .../complete` (`{sessionId, clientCompletionId}`), `POST .../abandon` (`{sessionId}`).

- [ ] **Step 1: Escrever o teste de contrato das rotas (falha)** — siga o padrão de `tests/unit/flashcard-api.test.ts` (mock do módulo `@/lib/learning/new-words`, importar os handlers das rotas, `Request`/`Response`):

```ts
// tests/unit/new-words-api.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { newWords } = vi.hoisted(() => ({ newWords: {
  getActiveNewWordsPractice: vi.fn(),
  createNewWordsPractice: vi.fn(),
  judgeNewWordsAttempt: vi.fn(),
  completeNewWordsPractice: vi.fn(),
  abandonNewWordsPractice: vi.fn()
} }));
vi.mock("../../lib/learning/new-words", () => newWords);

import { GET as getRoute, POST as postRoute } from "../../app/api/practice/new-words/route";
import { POST as judgeRoute } from "../../app/api/practice/new-words/judge/route";
import { POST as completeRoute } from "../../app/api/practice/new-words/complete/route";
import { POST as abandonRoute } from "../../app/api/practice/new-words/abandon/route";

const jsonRequest = (body: unknown) => new Request("http://localhost/api/practice/new-words", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});

describe("rotas /api/practice/new-words", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET devolve a sessão ativa", async () => {
    newWords.getActiveNewWordsPractice.mockResolvedValue({ sessionId: "s1", sentences: [] });
    const response = await getRoute();
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.activeSession.sessionId).toBe("s1");
  });

  it("POST cria a sessão com 201", async () => {
    newWords.createNewWordsPractice.mockResolvedValue({ sessionId: "s1", sentences: [{ id: "c1" }], words: [], languageCode: "en", languageName: "Inglês" });
    const response = await postRoute(jsonRequest({ count: 5 }));
    expect(response.status).toBe(201);
    expect(newWords.createNewWordsPractice).toHaveBeenCalledWith({ count: 5 });
  });

  it("judge repassa o body e devolve o julgamento", async () => {
    newWords.judgeNewWordsAttempt.mockResolvedValue({ sentenceId: "c1", judgment: { verdict: "correct" }, rating: "good", senseCreated: false });
    const response = await judgeRoute(jsonRequest({ sessionId: "s1", clientAttemptId: "attempt-0001", sentenceId: "c1", userTranslation: "eu como pão" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.attempt.judgment.verdict).toBe("correct");
  });

  it("complete devolve o resultado", async () => {
    newWords.completeNewWordsPractice.mockResolvedValue({ score: 100, sentenceCount: 3 });
    const response = await completeRoute(jsonRequest({ sessionId: "s1", clientCompletionId: "complete-0001" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.score).toBe(100);
  });

  it("abandon devolve status abandoned", async () => {
    newWords.abandonNewWordsPractice.mockResolvedValue({ sessionId: "s1", status: "abandoned" });
    const response = await abandonRoute(jsonRequest({ sessionId: "s1" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe("abandoned");
  });

  it("GET sem sessão ativa devolve null", async () => {
    newWords.getActiveNewWordsPractice.mockResolvedValue(null);
    const response = await getRoute();
    const data = await response.json();
    expect(data.activeSession).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-api` → FAIL.

- [ ] **Step 3: Implementar as 4 rotas**

```ts
// app/api/practice/new-words/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createNewWordsPractice, getActiveNewWordsPractice } from "@/lib/learning/new-words";

export async function GET() {
  try {
    const activeSession = await getActiveNewWordsPractice();
    return jsonOk({ ok: true, activeSession });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { count?: unknown };
    return jsonOk({ ok: true, ...(await createNewWordsPractice(body)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
```

```ts
// app/api/practice/new-words/judge/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { judgeNewWordsAttempt } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return jsonOk({ ok: true, attempt: await judgeNewWordsAttempt(body) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
```

```ts
// app/api/practice/new-words/complete/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { completeNewWordsPractice } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: unknown; clientCompletionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const clientCompletionId = typeof body.clientCompletionId === "string" ? body.clientCompletionId : "";
    return jsonOk({ ok: true, ...(await completeNewWordsPractice(sessionId, clientCompletionId)) });
  } catch (error) { return handleApiError(error); }
}
```

```ts
// app/api/practice/new-words/abandon/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { abandonNewWordsPractice } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: unknown };
    return jsonOk({ ok: true, ...(await abandonNewWordsPractice(typeof body.sessionId === "string" ? body.sessionId : "")) });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 4: Rate limit** — acrescentar em `apiRateLimitRules` (antes de `flashcards-create`):

```ts
  { name: "new-words-create", pattern: /^\/api\/practice\/new-words$/, limitPerMinute: 6 },
  { name: "new-words-judge", pattern: /^\/api\/practice\/new-words\/(judge|complete|abandon)$/, limitPerMinute: 30 },
```

- [ ] **Step 5: Rodar tudo** — `npm run test:unit` → PASS; `npm run typecheck` → PASS; `npm run lint` → PASS.

- [ ] **Step 6: Aplicar a migration no banco (local/qa)** — usar o mesmo fluxo das migrations anteriores (`0005`/`0006` já aplicadas no projeto Supabase). Verificar com um SELECT de insert inválido que os checks ativos: `insert into public.flashcards (practice_session_id, target_word_id, card_type) values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','bogus');` deve falhar; `'translation'` não.

- [ ] **Step 7: Commit**

```bash
git add app/api/practice/new-words lib/api/rate-limit.ts tests/unit/new-words-api.test.ts
git commit -m "feat: rotas da sessão de palavras novas com rate limit"
```

---

### Task 10: UI — `NewWordsTrainer` + página + entrada no treino

**Files:**
- Create: `components/NewWordsTrainer.tsx`
- Create: `app/palavras/novas/page.tsx`
- Modify: `components/FlashcardTrainer.tsx` (link no intro)
- Test: verificação manual + `npm run build` (a UI não tem testes de componente no repo)

**Interfaces:**
- Consumes: rotas da Task 9; `requestSpeech`, `unlockAudioForPlayback` (`voice-shared`/`speech`); `VoiceButton`; `newWordsSessionSizes`, `NewWordsSentence`, `JudgedTranslation`, `NewWordsSessionResult`, `NewWordPreview` (Task 1).

- [ ] **Step 1: Criar `components/NewWordsTrainer.tsx`**

```tsx
"use client";

import { ArrowLeft, Loader2, Mic, MicOff, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  newWordsSessionSizes,
  type JudgedTranslation,
  type NewWordPreview,
  type NewWordsSentence,
  type NewWordsSessionResult
} from "@/lib/learning/new-words-contracts";
import { unlockAudioForPlayback, requestSpeech, reportVoiceFailure } from "./voice-shared";
import { Pill } from "./Pill";
import { VoiceButton } from "./VoiceButton";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
type RecognitionConstructor = new () => Recognition;

export function NewWordsTrainer() {
  const [size, setSize] = useState<number>(5);
  const [sessionId, setSessionId] = useState("");
  const [completionId, setCompletionId] = useState("");
  const [sentences, setSentences] = useState<NewWordsSentence[]>([]);
  const [words, setWords] = useState<NewWordPreview[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<NewWordsSentence | null>(null);
  const [input, setInput] = useState("");
  const [judgment, setJudgment] = useState<JudgedTranslation | null>(null);
  const [result, setResult] = useState<NewWordsSessionResult | null>(null);
  const [resumable, setResumable] = useState<{ sessionId: string; nextSentenceId: string; answeredCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audioFailed, setAudioFailed] = useState(false);
  const [audioReplayCount, setAudioReplayCount] = useState(0);
  const [usedSpeech, setUsedSpeech] = useState(false);
  const [languageCode, setLanguageCode] = useState("en");
  const [languageName, setLanguageName] = useState("idioma estudado");
  const [startedAt, setStartedAt] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    void (async () => {
      try {
        const response = await fetch("/api/practice/new-words", { cache: "no-store" });
        const data = await response.json() as { ok?: boolean; activeSession?: { sessionId: string; nextSentenceId: string; answeredCount: number; languageCode: string; languageName: string } | null };
        if (response.ok && data.ok && data.activeSession && data.activeSession.nextSentenceId) {
          setResumable(data.activeSession);
          setLanguageCode(data.activeSession.languageCode ?? "en");
          setLanguageName(data.activeSession.languageName ?? "idioma estudado");
        }
      } catch { /* overview é best-effort */ }
    })();
    return () => { recognitionRef.current?.abort(); recognitionRef.current = null; };
  }, []);

  // Autoplay da frase corrente: um único <audio> destravado no gesto de iniciar.
  useEffect(() => {
    if (!current || judgment || audioFailed) return;
    let cancelled = false;
    setAudioReplayCount(0);
    (async () => {
      try {
        const audio = audioRef.current;
        if (!audio) return;
        const url = await requestSpeech(current.audioText, languageCode);
        if (cancelled) return;
        if (audio.src !== url) audio.src = url;
        await audio.play();
      } catch {
        if (!cancelled) { setAudioFailed(true); reportVoiceFailure(current.audioText, languageCode, "autoplay-rejected"); }
      }
    })();
    return () => { cancelled = true; };
  }, [current, judgment, audioFailed, languageCode]);

  async function start() {
    setBusy(true); setError("");
    // Destrava o áudio ainda no gesto do clique (iOS): todo autoplay seguinte
    // acontece no mesmo elemento já destravado.
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    unlockAudioForPlayback(audio);
    try {
      const response = await fetch("/api/practice/new-words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: size }) });
      const data = await response.json() as { ok?: boolean; error?: string; sessionId?: string; sentences?: NewWordsSentence[]; words?: NewWordPreview[]; languageCode?: string; languageName?: string };
      if (!response.ok || !data.ok || !data.sessionId || !data.sentences?.length) throw new Error(data.error ?? "Não foi possível montar a sessão.");
      setSessionId(data.sessionId); setCompletionId(crypto.randomUUID());
      setSentences(data.sentences); setWords(data.words ?? []);
      setAnsweredIds(new Set()); setCurrent(data.sentences[0]); setLanguageCode(data.languageCode ?? "en"); setLanguageName(data.languageName ?? "idioma estudado");
      setResumable(null); setResult(null); resetAttempt();
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Não foi possível montar a sessão."); }
    finally { setBusy(false); }
  }

  async function resume() {
    if (!resumable) return;
    setBusy(true); setError("");
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    unlockAudioForPlayback(audio);
    try {
      const response = await fetch("/api/practice/new-words", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; activeSession?: { sessionId: string; sentences: NewWordsSentence[]; words: NewWordPreview[]; answeredSentenceIds: string[]; nextSentenceId: string; languageCode: string; languageName: string } | null };
      const active = data.activeSession;
      if (!response.ok || !data.ok || !active) throw new Error("Não foi possível retomar a sessão.");
      setSessionId(active.sessionId); setCompletionId(crypto.randomUUID());
      setSentences(active.sentences); setWords(active.words ?? []);
      setAnsweredIds(new Set(active.answeredSentenceIds));
      setCurrent(active.sentences.find((sentence) => sentence.id === active.nextSentenceId) ?? null);
      setLanguageCode(active.languageCode ?? "en"); setLanguageName(active.languageName ?? "idioma estudado");
      setResumable(null); setResult(null); resetAttempt();
    } catch (resumeError) { setError(resumeError instanceof Error ? resumeError.message : "Não foi possível retomar."); }
    finally { setBusy(false); }
  }

  async function submitTranslation(event?: FormEvent) {
    event?.preventDefault();
    if (!current || judgment || busy || !input.trim()) return;
    recognitionRef.current?.stop();
    setBusy(true); setError("");
    const clientAttemptId = crypto.randomUUID();
    try {
      const response = await fetch("/api/practice/new-words/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        sessionId, clientAttemptId, sentenceId: current.id, userTranslation: input.trim(),
        responseTimeMs: Math.max(0, Date.now() - startedAt), usedSpeech, audioReplayCount, audioFailed
      }) });
      const data = await response.json() as { ok?: boolean; error?: string; attempt?: { judgment: JudgedTranslation; senseCreated: boolean } };
      if (!response.ok || !data.ok || !data.attempt) throw new Error(data.error ?? "Não foi possível avaliar a tradução.");
      setJudgment(data.attempt.judgment);
      setAnsweredIds((previous) => new Set([...previous, current.id]));
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Não foi possível avaliar a tradução."); }
    finally { setBusy(false); }
  }

  async function continueToNext() {
    if (!current) return;
    const index = sentences.findIndex((sentence) => sentence.id === current.id);
    const next = sentences[index + 1];
    if (next) { setCurrent(next); resetAttempt(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientCompletionId: completionId }) });
      const data = await response.json() as { ok?: boolean; error?: string } & Partial<NewWordsSessionResult>;
      if (!response.ok || !data.ok || typeof data.score !== "number") throw new Error(data.error ?? "Não foi possível concluir a sessão.");
      setResult(data as NewWordsSessionResult); setCurrent(null); setResumable(null);
    } catch (finishError) { setError(finishError instanceof Error ? finishError.message : "Não foi possível concluir a sessão."); }
    finally { setBusy(false); }
  }

  async function abandonSession() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      if (!response.ok) throw new Error("Não foi possível abandonar a sessão.");
      setSessionId(""); setSentences([]); setCurrent(null); setJudgment(null); setResumable(null); resetAttempt();
    } catch (abandonError) { setError(abandonError instanceof Error ? abandonError.message : "Não foi possível abandonar."); }
    finally { setBusy(false); }
  }

  function resetAttempt() {
    setInput(""); setJudgment(null); setAudioFailed(false); setUsedSpeech(false); setAudioReplayCount(0);
    setError(""); setStartedAt(Date.now());
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function toggleSpeech() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = "pt-BR"; recognition.interimResults = true; recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0]?.transcript ?? "";
      setInput(transcript.trim()); setUsedSpeech(true);
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; inputRef.current?.focus(); };
    recognition.onerror = () => { setListening(false); setError("Não foi possível transcrever. Digite sua tradução."); };
    setError(""); setListening(true); recognition.start();
  }

  if (result) return <div className="flashcard-screen">
    <audio ref={audioRef} className="sr-only" preload="auto" />
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-result">
      <div className="flashcard-trophy"><Trophy /></div>
      <div className="eyebrow">Sessão concluída</div>
      <h1 className="title">{result.score}% de acerto</h1>
      <p className="subtitle">Você aprendeu {result.wordCount} palavra{result.wordCount === 1 ? "" : "s"} nova{result.wordCount === 1 ? "" : "s"} com {result.sentenceCount} frases.</p>
      <div className="flashcard-result-grid">
        <div><strong>{result.wordCount}</strong><span>palavras novas</span></div>
        <div><strong>{result.correctSentences}/{result.sentenceCount}</strong><span>frases certas</span></div>
        <div><strong>{result.newSensesAdded}</strong><span>novos significados</span></div>
      </div>
      <section className="flashcard-result-details" aria-label="Palavras aprendidas">
        {result.words.map((word) => <div key={word.wordId}><span>{word.lemma}</span><strong>{word.translation}</strong></div>)}
      </section>
      <button className="green-button full-button" onClick={() => { setResult(null); setSentences([]); setWords([]); setAnsweredIds(new Set()); }} type="button"><Sparkles /> Aprender mais palavras</button>
      <Link className="outline-button full-button" href="/palavras">Voltar às palavras</Link>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  </div>;

  if (current) {
    const wordIndex = words.findIndex((word) => word.wordId === current.targetWordId);
    const sentenceOfWord = sentences.filter((sentence) => sentence.targetWordId === current.targetWordId);
    const ordinalOfWord = sentenceOfWord.findIndex((sentence) => sentence.id === current.id) + 1;
    return <div className="flashcard-screen">
      <audio ref={audioRef} className="sr-only" preload="auto" />
      <div className="top-row">
        <button className="back-link button-reset" onClick={() => void abandonSession()} disabled={busy} type="button"><ArrowLeft /> Sair</button>
        <Pill>{answeredIds.size}/{sentences.length} frases{wordIndex >= 0 ? ` · palavra ${wordIndex + 1}/${words.length}` : ""}</Pill>
      </div>
      <div className="progress-line"><span style={{ width: `${(answeredIds.size / Math.max(1, sentences.length)) * 100}%` }} /></div>
      <div className="flashcard-kind"><Pill tone="info">Traduza a frase{sentenceOfWord.length > 1 ? ` (${ordinalOfWord}/${sentenceOfWord.length} desta palavra)` : ""}</Pill></div>
      <section className="active-recall-card" aria-label="Frase para traduzir">
        <span>Traduza para o português</span>
        <strong>{current.sentence}</strong>
        {!audioFailed ? <VoiceButton compact languageCode={languageCode} label="Ouvir novamente" text={current.audioText} onPlayback={() => setAudioReplayCount((count) => count + 1)} onAudioFailure={() => setAudioFailed(true)} /> : <p className="flashcard-audio-fallback" role="status">Áudio indisponível. Continue pelo texto.</p>}
      </section>
      {!judgment ? <form className="flashcard-attempt" onSubmit={submitTranslation}>
        <label htmlFor="new-words-translation">Sua tradução em português</label>
        <div className="flashcard-input-row">
          <input autoComplete="off" id="new-words-translation" maxLength={300} onChange={(event) => setInput(event.target.value)} placeholder="Digite sua tradução" ref={inputRef} value={input} />
          <button aria-label={listening ? "Parar transcrição" : "Falar tradução"} className={listening ? "voice-icon-button listening" : "voice-icon-button"} disabled={!speechSupported} onClick={toggleSpeech} type="button">{listening ? <MicOff /> : <Mic />}</button>
        </div>
        <div className="flashcard-attempt-actions"><button className="green-button" disabled={!input.trim() || busy} type="submit">Traduzir</button></div>
      </form> : <section className="flashcard-reveal" aria-live="polite">
        <div><span>Tradução esperada</span><strong>{judgment.correctedTranslation}</strong></div>
        <div><span>Sua tradução</span><strong>{input}</strong></div>
        <p className={`answer-match ${judgment.verdict === "correct" ? "exact" : judgment.verdict === "acceptable" ? "acceptable" : judgment.verdict}`}>{verdictLabel(judgment.verdict)}</p>
        <p className="row-meta">{judgment.feedback}</p>
        {judgment.newSenseTranslation ? <p className="speech-status">Registrado: “{judgment.newSenseTranslation}” entrou como novo significado desta palavra.</p> : null}
        <div className="recall-rating-grid"><button className="suggested" disabled={busy} onClick={() => void continueToNext()} type="button">Continuar</button></div>
      </section>}
      {busy ? <p className="speech-status"><Loader2 className="spin" /> Salvando...</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>;
  }

  return <div className="flashcard-screen">
    {/* O MESMO elemento <audio> precisa existir em todas as telas: é ele que é
        destravado no gesto de "Começar" e reusado pelo autoplay de cada frase. */}
    <audio ref={audioRef} className="sr-only" preload="auto" />
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-intro">
      <div className="flashcard-brand"><Sparkles /></div>
      <div><div className="eyebrow">Vocabulário novo</div><h1 className="title">Palavras novas</h1><p className="subtitle">A IA escolhe palavras do seu nível, monta frases com o que você já sabe e corrige suas traduções como um professor.</p></div>
    </section>
    {resumable ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="resume-new-words" aria-modal="true" className="confirmation-modal" role="dialog">
      <h2 className="section-title" id="resume-new-words">Sessão em andamento</h2>
      <p className="row-meta">Você já traduziu {resumable.answeredCount} frases desta sessão.</p>
      <div className="flashcard-resume-actions">
        <button className="green-button" disabled={busy} onClick={() => void resume()} type="button">Continuar sessão</button>
        <button className="danger-button" disabled={busy} onClick={() => { setResumable(null); void abandonResumable(resumable.sessionId); }} type="button">Abandonar</button>
      </div>
    </section></div> : null}
    <section className="section">
      <h2 className="section-title">Quantas palavras quer aprender?</h2>
      <div className="flashcard-choice-grid">
        {newWordsSessionSizes.map((option) => (
          <button key={option} className={size === option ? "choice-card active" : "choice-card"} disabled={busy} onClick={() => setSize(option)} type="button">
            <div><strong>{option}</strong><span>palavras · {option * 3} frases</span></div>
          </button>
        ))}
      </div>
      <button className="green-button full-button" disabled={busy} onClick={() => void start()} type="button">
        {busy ? <><Loader2 className="spin" /> Escolhendo palavras e montando frases...</> : <><Sparkles /> Começar com {size} palavra{size === 1 ? "" : "s"}</>}
      </button>
      <p className="row-meta">Cada palavra vem em {3} frases curtas. Ouça, traduza e a IA corrige na hora.</p>
    </section>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;

  async function abandonResumable(targetSessionId: string) {
    setBusy(true);
    try {
      await fetch("/api/practice/new-words/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: targetSessionId }) });
    } finally { setBusy(false); }
  }
}

function verdictLabel(verdict: JudgedTranslation["verdict"]) {
  if (verdict === "correct") return "Tradução correta!";
  if (verdict === "acceptable") return "Correta — com uma nuance diferente";
  if (verdict === "minor_error") return "Quase isso";
  return "Não é essa";
}
```

> Notas: (a) a retomada usa `answeredSentenceIds`/`nextSentenceId` devolvidos pelo GET (`getActiveNewWordsPractice`, Task 6). (b) Reaproveite as classes CSS existentes do `FlashcardTrainer` (`flashcard-*`, `choice-card`, `confirmation-modal`); crie CSS novo apenas se algo faltar. (c) O áudio é sintetizado pelo Kokoro via `requestSpeech` (rota `/api/voice/synthesize`), preguiçosamente por frase e com cache — replay não re-sintetiza. Opcional: ao exibir uma frase, pré-chame `requestSpeech` para a frase seguinte (fire-and-forget) para eliminar a espera na troca; o cache do cliente deduplica e o teto de 30 sínteses/min (`voice-synthesize`) continua folgado.

- [ ] **Step 2: Criar `app/palavras/novas/page.tsx`**

```tsx
import { AppShell } from "@/components/AppShell";
import { NewWordsTrainer } from "@/components/NewWordsTrainer";

export const dynamic = "force-dynamic";

export default function NewWordsPracticePage() {
  return <AppShell activeNav="palavras" section="palavras" noNav><NewWordsTrainer /></AppShell>;
}
```

- [ ] **Step 3: Entrada no treino** — em `components/FlashcardTrainer.tsx`, no bloco do intro (junto a "Sessão custom"), adicionar:

```tsx
    <Link className="outline-button full-button" href="/palavras/novas"><Sparkles /> Aprender palavras novas</Link>
```

(`Sparkles` e `Link` já estão importados no arquivo.)

- [ ] **Step 4: Verificação** — `npm run build` → PASS; teste manual local (`npm run dev`): iniciar sessão com 5 palavras → áudio toca ao abrir cada frase → traduzir → feedback do professor aparece → concluir → resultado lista as palavras. Retomar: recarregar a página no meio da sessão e continuar. Verificar no banco: `words` criadas, `word_senses` primários, `flashcards` com `card_type='translation'`, tentativas com `judgment_json`, e — ao traduzir com um significado alternativo válido — novo `word_senses` com `source='session'`.

- [ ] **Step 5: Commit**

```bash
git add components/NewWordsTrainer.tsx app/palavras/novas/page.tsx components/FlashcardTrainer.tsx
git commit -m "feat: UI da sessão de palavras novas com áudio automático e correção pela IA"
```

---

## Verificação final (task de fechamento)

- [ ] `npm run test:unit` — suíte inteira PASS (inclui regressão de flashcards/daily-feedback).
- [ ] `npm run typecheck && npm run lint && npm run build` — PASS.
- [ ] Migração aplicada e check constraints validados (Step 6 da Task 9).
- [ ] Fluxo ponta a ponta em QA: 3/5/8 palavras; áudio no iOS (autoplay após gesto) e fallback; retomada; abandono; sessão ativa bloqueia nova (409); expansão de sentido grava `word_senses` com `source='session'` e aparece em `/palavras/[wordId]`.
- [ ] Critérios da spec conferidos um a um (seção Spec do cabeçalho).

## Riscos e limitações aceitas

- **Geração síncrona na abertura**: criar a sessão faz 2 chamadas de IA (palavras + frases); pode levar ~15–30s — a UI mostra "Escolhendo palavras e montando frases...". Igual ao padrão dos flashcards.
- **Abandono mantém as palavras no banco**: coerente com SRS (o aluno já as viu); a fila diária pode reforçá-las.
- **≤1 token lexical desconhecido por frase**: escapatória para flexões (mesma regra dos flashcards); frases com 2+ desconhecidas são rejeitadas.
- **Sem undo**: cada frase é apresentada 1×; a revisão SRS aplicada não é desfeita.
- **Custo de IA**: 1 chamada de proposta + 1 de frases por sessão + 1 julgamento por frase (até 24) — dentro do padrão de uso do app e coberta por rate limit.
