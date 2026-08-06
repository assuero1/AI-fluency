# Auditoria de linha de base dos flashcards — 2026-08-06

Branch: `feat/flashcard-binary-rating`. Task 1 do plano de simplificação dos flashcards.
Objetivo: fixar, via testes de caracterização, o comportamento REAL atual dos recursos de
flashcard antes das mudanças das tasks seguintes. Nenhum comportamento foi alterado.

## Linha de base (Step 1)

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 erros; 1 warning pré-existente (`components/FlashcardTrainer.tsx:77` — `react-hooks/exhaustive-deps`, `loadOverview`) |
| Typecheck | `npm run typecheck` | ✅ limpo |
| Unit | `npm run test:unit` | ✅ 53 arquivos, 340 testes (antes dos acréscimos desta auditoria) |

Após os testes adicionados nesta auditoria: **53 arquivos, 345 testes, todos verdes**; lint e
typecheck inalterados.

## Cobertura do checklist (Steps 2–3)

### 1. `computeDailyQueue` — `lib/learning/daily-queue.ts:51-76` ✅ coberto

Comportamento esperado: vencidas até o fim do dia no fuso local; novas = `last_reviewed_at`
vazio, ordenadas por `first_used_at`; quota efetiva `max(0, quota - introducedToday)`;
interleaving determinístico por seed; cap de sessão 30 com overflow em `remainingWordIds`.

Coberto por `tests/unit/daily-queue.test.ts`:
- "includes reviews due until end of local day, oldest first" (l. 68)
- "respects the local timezone boundary" (l. 77)
- "limits new cards by quota minus what was already introduced today" (l. 86) — inclui
  `introducedToday > quota` → zero novas
- "caps the session and moves the overflow to remaining" (l. 98)
- "interleaves new cards into the session order" (l. 106) + describe `interleaveWords` (l. 42)
- `isNewWord` (l. 35) confirma o critério `last_reviewed_at` vazio

### 2. `countNewCardsIntroducedToday` — `lib/learning/daily-queue.ts:102-118` ✅ coberto

Comportamento esperado: somente sessões `flashcards` com status `completed`/`active`, do dia
local, do usuário/perfil, e `queueKind === "daily"` no focus contam para a quota.

Coberto por `tests/unit/daily-queue.test.ts`:
- "sums only today's completed/active daily sessions" (l. 131) — exclui `abandoned`,
  `queueKind: "custom"` e sessões de outro tipo
- "ignores sessions from other users and tolerates broken focus JSON" (l. 143)

### 3. `selectDifficultWords` — `lib/learning/daily-queue.ts:142-147` ⚠️ lacuna parcial → teste adicionado

Comportamento esperado: filtra `review_state === "difficult"` OU `leech_flagged_at` presente;
ordena por `lapse_count` desc com desempate por `review_due_at` asc; cap 30.

- Já coberto: filtro difficult/leech e ordenação `lapse_count` desc
  (`daily-queue.test.ts` l. 182, "selects difficult or leech-flagged words, most lapses first").
- **Lacuna → teste adicionado**: "breaks lapse ties by earliest due date and caps the
  selection at 30" — caracteriza o desempate por `review_due_at` asc e o cap de 30.
  Comportamento observado confere com o esperado.

### 4. `selectFlashcardWords` — `lib/learning/flashcards.ts:162-174` ✅ coberto

Comportamento esperado: vencidas primeiro (nunca agendadas = `review_due_at` ausente contam
como vencidas), critério ordena dentro do grupo de vencidas, demais preenchidas pelas próximas
a vencer; tamanho do deck clampado por `normalizeFlashcardCount` (2–30,
`flashcards.ts:158-160`).

Coberto por `tests/unit/flashcards.test.ts`:
- "prioritizes due reviews and fills the deck with the closest upcoming ones" (l. 65) —
  equivalente ao exemplo do Step 3 do brief: `["never-scheduled", "due", "upcoming-near"]`
- "keeps the criterion ordering inside the due group" (l. 77)
- "normalizes criterion and requested deck size" (l. 26) — clamp 2–30

### 5. Fila pedagógica — `lib/learning/flashcard-queue.ts` ⚠️ lacuna parcial → testes adicionados

Comportamento esperado: `forgot` reagenda +3 apresentações, `hard` +5
(`advanceFlashcardQueue` l. 14-25); máximo de 3 apresentações por card; `selectNextQueueItem`
respeita `dueAfterIndex` (l. 27-32); `rebuildFlashcardQueue` reconstrói o estado para retomada
e rejeita histórico divergente (l. 38-48).

- Já coberto (`tests/unit/flashcard-queue.test.ts`): +3/+5 (l. 15, 25), máx. 3 apresentações
  (l. 29), `good`/`easy` não reagendam, fila vazia → `null` (l. 32).
- **Lacuna → testes adicionados**:
  - "rebuilds the queue from persisted attempts for resume" — reconstrução exata da fila e do
    `currentItem` após um `forgot` persistido.
  - "rejects a persisted history that diverges from the queue order" — lança
    "O histórico da fila não corresponde às apresentações persistidas." tanto para card fora
    de ordem quanto para `presentationNumber` divergente.
  Comportamento observado confere com o esperado. (A retomada ponta-a-ponta já era coberta
  indiretamente por `flashcard-persistence.test.ts` l. 132, "reconstructs the next
  presentation from persisted history".)

### 6. `calculateAdaptiveReview` — `lib/learning/spaced-repetition.ts:70-121` ⚠️ lacuna parcial → testes adicionados

Comportamento esperado: passos de aprendizado [1, 3]; graduação em 7 dias (`good`) ou 15
(`easy`); regraduação pós-lapse com ×0.5 (`good`) / ×0.75 (`easy`) e piso de 4 dias
(l. 190-193); ease limitado a 1.3–2.8 (l. 58-59); leech a partir de 4 lapsos
(`LEECH_LAPSE_THRESHOLD`, l. 5); fuzz determinístico de ±10% apenas para intervalos ≥ 7 dias
com seed (l. 254-260).

- Já coberto (`tests/unit/spaced-repetition.test.ts`): passos [1,3] (l. 7, 17), graduação
  7/15 (l. 24, 33), crescimento pós-graduação (l. 37), lapse → relearning mantendo intervalo
  pré-lapse (l. 45), regraduação ×0.5 (l. 57), recuperação dentro da sessão (l. 65), `hard`
  graduado em 1–4 dias (l. 74), `hard` em learning repete o passo (l. 82), leech ≥ 4 com
  timestamp preservado (l. 91), fuzz ±10% determinístico só com seed (l. 104), due date no
  calendário do fuso (l. 116), clamps de ease máx. 2.8 e intervalo máx. 365 (l. 122),
  suspenso preservado (l. 130), exige ≥ 1 attempt (l. 135).
- **Lacuna → testes adicionados**:
  - "regraduates from relearning with three quarters of the pre-lapse interval on easy" —
    intervalo 20 × 0.75 = 15 dias, `learningStep` 3, ease 2.3 → 2.4.
  - "floors the regraduated interval at four days" — intervalo 6 × 0.5 = 3 → clampado em 4.
  Comportamento observado confere com o esperado em ambos.

### 7. `validateFlashcardAnswers` — `lib/learning/flashcards.ts:176-201` ✅ coberto

Comportamento esperado: entre 1 e 3 apresentações por card; apresentações sequenciais e na
ordem; resposta vazia exige `forgot`.

Coberto por `tests/unit/flashcards.test.ts`:
- "accepts one matching answer per persisted card" (l. 95)
- "rejects duplicate, missing, or tampered card answers" (l. 105) — inclui resposta vazia
- "accepts sequential re-presentations and rejects gaps or a fourth attempt" (l. 112)

### 8. Review incremental + `review_applied` ✅ coberto

Coberto por `tests/unit/flashcard-persistence.test.ts`:
- "applies the SRS update incrementally and marks the attempt as applied" (l. 57) — update da
  palavra com `review_version: "srs-v2"` e marcação `review_applied: true` +
  `resulting_review_state`.
- "keeps the attempt unapplied when the incremental SRS write fails" (l. 74).
- "skips the incremental SRS update for listening attempts with audio failure" (l. 94).
- Complementar: `tests/unit/flashcard-completion.test.ts` usa `review_applied` no fluxo de
  conclusão da sessão (l. 163).

## Bugs encontrados

Nenhum. Todos os comportamentos observados nos novos testes de caracterização conferem com o
comportamento esperado documentado no código e no checklist.

## Decisões pendentes

Nenhuma discrepância de comportamento visível foi observada nesta auditoria.

Observação fora de escopo (não é bug desta auditoria, não corrigida): warning de lint
pré-existente em `components/FlashcardTrainer.tsx:77` (`react-hooks/exhaustive-deps`,
dependência `loadOverview` ausente no `useEffect`).

## Resumo dos acréscimos

| Arquivo de teste | Testes adicionados |
|---|---|
| `tests/unit/daily-queue.test.ts` | 1 (desempate por due date + cap 30 em `selectDifficultWords`) |
| `tests/unit/flashcard-queue.test.ts` | 2 (reconstrução da fila para retomada; rejeição de histórico divergente) |
| `tests/unit/spaced-repetition.test.ts` | 2 (regraduação ×0.75 no `easy`; piso de 4 dias na regraduação) |

Total: 5 testes novos, 340 → 345, todos verdes.
