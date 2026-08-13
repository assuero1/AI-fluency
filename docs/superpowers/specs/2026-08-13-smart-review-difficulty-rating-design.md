# Revisão inteligente — rating por dificuldade, correções do type-in e robustez da geração de frases

Data: 2026-08-13
Status: aprovado pelo usuário (design)

## Contexto

A sessão de revisão inteligente (`app/palavras/treino` + `components/FlashcardTrainer.tsx`, regra em `lib/learning/flashcards.ts`, `flashcard-queue.ts`, `flashcard-answer.ts`, `spaced-repetition.ts`, `daily-queue.ts`) usa hoje avaliação binária "Não lembrei"/"Lembrei" (`resolveBinaryRating`, `flashcard-queue.ts:16`), com nota de 4 valores inferida por acerto + latência.

Problemas identificados nesta revisão:

1. **Semântica injusta dos botões**: o usuário que digita a resposta correta já provou que lembrou; a pergunta real pós-revelação é "quão difícil foi?". Manter "Não lembrei" = lapso para quem acertou com esforço penaliza o agendamento injustamente.
2. **Bug do ditado por voz**: em cards `listening`, o label diz que a resposta é em português (`FlashcardTrainer.tsx:280`), mas o reconhecimento de voz usa o idioma estudado (`:224`). Quem dita a resposta é penalizado com match incorreto.
3. **Inconsistência no "Não lembro"**: clicar "Não lembro" com texto já digitado envia `userAnswer` junto; no round-trip do servidor (`attemptRecordToAnswer`, `flashcards.ts:988`) a tentativa volta com `forgot: false`.
4. **Geração de frases frágil**: `generatePhrases` (`flashcards.ts:858-871`) é uma chamada única em lote com timeout de 8s e `catch` → `Map` vazio. Qualquer falha descarta todas as frases do lote; `validateGeneratedPhrases` (`:835-856`) descarta frases sem telemetria por motivo. Isso dispara a mensagem "O treino foi adaptado porque algumas frases contextuais não passaram na validação" (`FlashcardTrainer.tsx:263`, flag em `buildDeck`, `flashcards.ts:829`).
5. **Flag `adapted` impreciso**: só compara contagem de cloze planejado vs. construído; quedas de outros tipos (escuta sem áudio, tradução sem `nativeText`) não ligam o flag, e `:880` pode inclusive criar cloze extra.

## Decisões aprovadas

- Remap semântico completo: "Difícil" = rating `hard` (reapresenta na sessão, **sem lapso**); "Fácil" = `easy`/`good` conforme latência. Resposta errada (`incorrect`/`unknown`) ou "Não lembro" → `forgot` automático, sem escolha de botão.
- Robustez + mensagem: retry com backoff na geração de frases, ajuste de prompt, telemetria das causas de rejeição e nova copy para a mensagem de treino adaptado.
- Incluir os 4 itens da revisão geral: correção do ditado por voz, limpar texto no "Não lembro", flag `adapted` mais preciso, erro = avanço sem escolha.
- Abordagem cirúrgica: novo campo `difficulty` opcional na API com fallback para o legado `remembered` (sessões em andamento não quebram no deploy).

## Design

### 1. Remap semântico "Difícil" / "Fácil"

**Cliente** (`components/FlashcardTrainer.tsx`):

- Seção de revelação (`:284-293`) passa a ter dois modos:
  - **Auto-forgot**: se `revealed.match` ∈ {`incorrect`, `unknown`} ou `revealed.forgot`, não exibir escolha. Mostrar resposta correta, mensagem "Sem problema — este card volta ainda nesta sessão." e botão único **"Continuar"** → `grade({ forgot: true })`.
  - **Escolha de dificuldade**: caso contrário (`exact`/`acceptable`/`minor_error`), botões **"Difícil"** e **"Fácil"**, cada um com dica de intervalo (`→ N dias`). "Fácil" mantém o ícone `Check`; "Difícil" não usa o ícone `X` (que sugere erro sob a nova semântica) — fica sem ícone.
- `grade` passa a enviar `difficulty: "hard" | "easy"` (quando há escolha) ou `forgot: true` (auto-forgot), sempre com `userAnswer`, `responseTimeMs`, `clientAttemptId` etc. como hoje.
- Caminho "Não lembro" (`submitAttempt(event, true)`): limpar `input` e enviar `userAnswer` vazio quando `forgot=true`.
- Fix do ditado: `recognition.lang = "pt-BR"` para `target_to_native` **e** `listening`; demais tipos usam `languageCode`.
- Interval hints: preview passa a retornar `hardDays`/`easyDays` (ver §3); cliente exibe `hardDays` em "Difícil" e `easyDays` em "Fácil".

**Resolução de rating no servidor** (`lib/learning/flashcard-queue.ts`):

```ts
export function resolveDifficultyRating(input: {
  difficulty: "hard" | "easy";
  match: AnswerMatch; forgot: boolean;
  responseTimeMs: number; cardType: Flashcard["type"];
}): RecallRating {
  if (input.forgot || input.match === "incorrect" || input.match === "unknown") return "forgot";
  if (input.difficulty === "hard") return "hard";
  return inferRecallRating(input); // easy se rápido, senão good
}
```

- `resolveBinaryRating` permanece para o caminho legado (`remembered` sem `difficulty`).
- Fila inalterada: `forgot`/`hard` reapresentam (+3/+5 apresentações, máx. 3) — `flashcard-queue.ts:22-33`. `hard` não é lapso no SRS.

**Contrato da API**:

- `POST /api/practice/flashcards/attempt`: aceita novo campo opcional `difficulty: "hard" | "easy"`. Se ausente, usa o mapeamento legado via `remembered` (backward compat para sessões iniciadas antes do deploy).
- Validação: `difficulty` presente → usar `resolveDifficultyRating`; ausente → `resolveBinaryRating`.

### 2. Correções do type-in

- Ditado por voz em cards `listening` usa `pt-BR` (alinha com o label "Resposta esperada em português").
- "Não lembro" limpa o input e não envia `userAnswer`.

### 3. Preview de intervalos

- `previewFlashcardAttemptIntervals` (`flashcards.ts:608-656`) passa a calcular e retornar `forgotDays`, `hardDays` e `easyDays` (este último com o `responseTimeMs` real da tentativa, cobrindo o split easy/good). Cliente usa `hardDays`/`easyDays` nos botões; `forgotDays` não é mais exibido (o caminho auto-forgot não mostra intervalo).

### 4. Robustez da geração de frases

- `generatePhrases` (`flashcards.ts:858-871`): 1 retry com backoff (~600ms) quando a chamada falha, estoura o timeout de 8s ou retorna JSON inválido. Mantido o `catch` → `Map` vazio como último recurso.
- Prompt: reforçar "use a palavra-alvo exatamente como fornecida, uma única vez, sem flexionar" e "use somente palavras muito comuns do idioma".
- `validateGeneratedPhrases` (`:835-856`) passa a retornar, além do mapa de frases válidas, um objeto `rejectionReasons: Record<string, number>` (motivos: `invalid_shape`, `too_many_words`, `technical_tokens`, `unknown_words`, `duplicate`, `bad_word_ids`, `target_occurrences`, `already_has_phrase`).
- Telemetria: evento `flashcard_generation_completed` ganha `rejection_reasons` e `fallbacks_by_type`.

### 5. Flag `adapted` preciso + nova copy

- `buildDeck` (`flashcards.ts:829`): `adapted = cards.some((card) => card.generationSource === "fallback")` — qualquer queda de tipo planejado, não só cloze.
- Nova copy em `FlashcardTrainer.tsx:263`: **"Ajustamos algumas atividades do treino de hoje para manter o ritmo."** (tom neutro, sem sugerir erro).

## Error handling

- Falha total da geração (retry incluso): comportamento atual preservado — fallback por card para `native_to_target`/`target_to_native`, flag `adapted`, telemetria `fallback_used`.
- Preview falha: fallback local atual (botões sem dica de intervalo) preservado.
- `difficulty` inválido/ausente com `remembered` ausente: 400 como hoje para payload malformado.

## Testes

- **Unit**:
  - Novos testes de `resolveDifficultyRating` (difficulty hard/easy × match × forgot × latência).
  - Atualizar testes que referenciam o mapeamento "Não lembrei" (`flashcard-persistence.test.ts:145,158`) para cobrir ambos os caminhos (legado + difficulty).
  - Retry de `generatePhrases`: falha uma vez → sucesso na segunda; falha dupla → fallback.
  - `buildDeck`: `adapted === true` quando um card não-cloze cai para fallback.
  - `validateGeneratedPhrases`: contagens de `rejectionReasons`.
- **E2E** (`tests/e2e/qa-flow.spec.ts`):
  - Renomear cliques para "Difícil"/"Fácil".
  - Novo cenário: resposta errada → sem botões de escolha, "Continuar" avança e registra `forgot`.

## Arquivos tocados

- `components/FlashcardTrainer.tsx`
- `lib/learning/flashcard-queue.ts`
- `lib/learning/flashcards.ts`
- `lib/learning/flashcard-contracts.ts`
- `tests/unit/flashcard-persistence.test.ts`, `tests/unit/flashcard-generation-fallback.test.ts`, novos testes unitários
- `tests/e2e/qa-flow.spec.ts`

## Fora de escopo

- Reformulação do contrato de ponta a ponta (eliminar `remembered` legado) — fica para uma limpeza futura, após todas as sessões pré-deploy expirarem.
- Mudanças na matemática SRS (`spaced-repetition.ts`) — os ratings já existem; apenas a origem deles muda.
