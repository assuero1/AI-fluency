# Reformulação da Revisão Inteligente — Design

Data: 2026-08-02
Status: aguardando revisão do usuário
Escopo: somente a Revisão Inteligente (flashcards / repetição espaçada) — `/palavras/treino`, `lib/learning/flashcards*`, `lib/learning/spaced-repetition.ts` e pontos de integração (home, página de palavras, salvamento de vocabulário em conversa).

## 1. Contexto e diagnóstico

A Revisão Inteligente atual (SRS `srs-v1`, PRs 0–7) já tem uma base forte: recuperação ativa obrigatória (digitar/falar antes de revelar), 4 botões de avaliação com rating sugerido, fila de reapresentação dentro da sessão (forgot +3, hard +5, máx. 3 apresentações), deck congelado com seed, idempotência por `client_attempt_id`/completionId, persistência por tentativa e telemetria.

Problemas encontrados na análise (código + docs):

1. **SRS só grava no fim da sessão** (`completeFlashcardPractice`, `lib/learning/flashcards.ts:498-515`). Abandono ou fechamento do app no meio da sessão perde todo o agendamento das tentativas já feitas.
2. **Conversa pisa no SRS**: `persistSelectedVocabulary` (`lib/learning/vocabulary-selection.ts:496`) regrava `review_due_at = now + 7d` a cada reaparição da palavra em conversa, destruindo intervalos maiores calculados pelo SRS.
3. **Cards novos sem quota**: palavras nunca revisadas entram misturadas com vencidas na seleção (`flashcards.ts:139-147`), sem cap diário — sessões podem virar blocos de material novo (pior formato para retenção).
4. **Leech handling inerte**: `review_state = "difficult"` é detectado mas nada acontece; `suspended` nunca é atribuído pelo código.
5. **Distribuição 100% compreensão**: `getActiveRecallDistribution` (`flashcards.ts:154`) está hardcoded para `target_to_native`. `native_to_target`, `cloze` e `listening` têm contrato, UI, validação e métricas prontos mas nunca são gerados. Métricas por competência (`productionAccuracy`/`listeningAccuracy`, `flashcards.ts:534`) tendem a `null`.
6. **Escalabilidade frágil**: full-table scans com limites rígidos (`flashcardAttempts` até 1000) — resume/complete pode operar sobre subconjunto silenciosamente; travas apenas in-process.
7. **Docs desatualizados/contraditórios**: `FLASHCARD_IMPLEMENTATION_PLAN.md` ainda descreve a distribuição 25/40/35 e PRs de cloze/listening como ativos; `FLASHCARD_CURRENT_FLOW.md` descreve fluxo pré-PR 1; `AI_FLUENCY_BUILD_PLAN.md` lista SRS avançado como futuro (P2) embora já exista.
8. **Código morto**: `calculateLegacyWordReview` (`flashcards.ts:186`) sem callers.

Decisões do usuário (brainstorming):

- Mix de tipos de card (compreensão, produção, cloze, escuta, frase).
- Fila diária estilo Anki como padrão (com opção custom).
- Cards de tradução de frase completa (PT→idioma) corrigidos por IA.
- Abordagem A: evolução profunda mantendo a arquitetura de sessões/Teable, em fases.

## 2. Objetivos

- Aumentar retenção real: produção ativa e variedade de exercícios, não só reconhecimento.
- Criar hábito diário: fila calculada pelo servidor, sem decisões manuais de critério/quantidade.
- Nunca perder progresso de agendamento (abandono, crash, conversa).
- Tratar palavras difíceis com variedade, não só mais repetição.
- Manter os princípios do projeto: servidor como fonte oficial, idempotência, IA só para criação/análise linguística, falha de IA/áudio/STT nunca bloqueia o treino.

Fora de escopo: extração de vocabulário das conversas (review de 31/07), redesign da página de palavras como um todo, mudanças destrutivas de schema, FSRS completo.

## 3. Modelo pedagógico — fila diária

- A revisão passa a ser uma **fila diária calculada pelo servidor**: `review_due_at <= fim do dia local` (timezone do usuário, due às 9h locais como hoje).
- **Quota de novos cards**: default 10/dia, configurável em settings (`daily_new_cards_quota`). Vencidas nunca têm cap.
- **Ordem na sessão**: interleaving — novos inseridos entre revisões; reapresentações mantêm os gaps atuais (3/5 posições, máx. 3 apresentações).
- **Cap de sessão**: ~30 cards + reapresentações; excedente vira "continuar depois" (sessão encadeada no mesmo dia, sem quota extra de novos).
- Tela inicial mostra "Hoje: X revisões + Y novas" + botão **Começar**. Secundários: "Sessão custom" (slider 2–30 atual) e "Só difíceis".
- Critérios `least_used`/`oldest` sobrevivem apenas na sessão custom.

## 4. Tipos de card e avaliação

| Tipo | Prompt | Resposta | Correção |
|---|---|---|---|
| `target_to_native` (compreensão) | Palavra no idioma + áudio | Digita/fala em PT | Determinística (atual) |
| `native_to_target` (produção) | Palavra em PT | Digita/fala no idioma | Determinística + formas flexionadas aceitas |
| `cloze` | Frase com lacuna no idioma | Palavra que falta | Determinística |
| `listening` | Só áudio, sem texto | Digita o que ouviu | Determinística |
| `sentence_translation` (novo) | Frase em PT gerada pela IA usando 1–2 palavras-alvo do usuário | Traduz a frase | Avaliada pela IA |

Escolha do tipo por estágio da palavra:

- **Novas** (`new`/`learning`): 70% compreensão, 30% cloze.
- **Em revisão** (`review`): 40% produção, 25% compreensão, 20% cloze, 15% escuta (escuta só se áudio habilitado; caso contrário redistribui para produção/compreensão).
- **Difíceis** (`difficult`): variedade máxima + prioridade para frase.
- **Frases**: 1–3 por sessão, reservadas a palavras com streak ≥ 2.

Avaliação da frase por IA: chamada por card no submit, retornando JSON `{ verdict: correct|partial|incorrect, feedback, betterVersion }`; timeout ~6s; fallback determinístico (presença das palavras-alvo → rating sugerido simples). Falha de IA nunca bloqueia o treino.

Todos os tipos mantêm: tentativa obrigatória antes de revelar, rating sugerido automaticamente, usuário pode sobrescrever nos 4 botões. O rating final alimenta o SRS; o tipo influencia o alvo de tempo de resposta (tabela já existente).

## 5. Algoritmo SRS v2

Base `srs-v1` mantida (4 ratings, escadas iniciais, ease 1.3–2.8, ajuste por tempo, agregação por pior resultado, timezone). Mudanças:

1. **Passos de aprendizado**: palavra nova entra em `learning` com passos 1d → 3d antes de graduar para `review` (escada 7/15/30). `forgot` em `review` → 1 dia + relearning (1d → 3d) antes de regraduar. Hoje um único "Lembrei" manda material novo direto para 3 dias.
2. **Fuzz de ±10%** nos intervalos, determinístico (derivado da seed do card), para dessincronizar cards revisados juntos.
3. **Leech handling**: `lapse_count >= 4` ou `difficult` persistente → `leech_flagged_at` gravado; palavra priorizada para frase/variedade e ganha selo "precisa de atenção" na página de palavras. Suspensão continua manual.
4. **Persistência incremental**: cada tentativa persistida recalcula e grava o estado SRS da palavra na hora; `complete` vira fechamento de métricas + fallback de recálculo se alguma gravação incremental falhou.
5. **Desacoplamento conversa↔SRS**: `persistSelectedVocabulary` para de regravar `review_due_at`. Uso correto em conversa de palavra vencida conta como **revisão implícita leve** (adianta o due como um "good", sem ease bump, registra `implicit_review_at`); palavra agendada no futuro não é alterada.
6. **`review_version = "srs-v2"`**: migração aditiva — ease/intervalo/streak existentes preservados; novos passos valem a partir da próxima transição.

Correções adjacentes no escopo: métricas por competência voltam a ser reais; scans do fluxo de tentativa/complete passam a filtrar por `sessionId` no server-side em vez de listar 1000 e filtrar em memória; remoção de `calculateLegacyWordReview`.

## 6. Experiência do usuário

- **Tela inicial**: resumo do dia (X revisões + Y novas), estimativa de tempo (~1 min/5 cards), botão Começar; secundários custom/difíceis; modal de sessão ativa mantido (continuar agora não perde SRS).
- **Durante o card**: indicador de tipo e progresso ("card 7 de 23 · 3 reapresentações"); frases mostram feedback da IA ao revelar (✅/⚠️/❌ + correção curta + alternativa); micro-feedback de agendamento em cada botão ("Lembrei → 7 dias").
- **Resultado**: score, métricas por competência reais, palavras graduadas, difíceis, streak diário; retreinos "erradas"/"difíceis" e "usar em conversa" mantidos.
- **Página de palavras**: card "Revisão inteligente" mostra a fila do dia; selo "precisa de atenção" em leeches.
- **Home**: gancho de revisões vencidas (`lib/learning/home.ts`) passa a refletir a fila diária.
- **Offline/falhas**: idempotência mantida; falha na gravação incremental do SRS é compensada pelo recálculo no complete.

## 7. Modelo de dados (Teable — tudo aditivo)

- **`words`**: + `learning_step` (int), `implicit_review_at` (datetime), `leech_flagged_at` (datetime). `review_version` aceita `"srs-v2"`.
- **`flashcards`**: `card_type` + `sentence_translation`; + `ai_feedback_json` (texto JSON: verdict, feedback, betterVersion).
- **`flashcardAttempts`**: + `resulting_review_state` (auditoria da gravação incremental).
- **`practiceSessions`**: config/focus + `queueKind: daily|custom|difficult`, `newCardsIntroduced`, `dailyQuota`.
- **settings do usuário**: `daily_new_cards_quota` (default 10).
- Migração via script em `scripts/` no padrão `ensure-*.mjs`, validado em QA antes de produção.

## 8. Erros e limites

- IA com timeout (deck 8s; avaliação de frase ~6s) e fallback determinístico.
- Falha de áudio/STT degrada para texto sem penalizar domínio.
- Idempotência por `client_attempt_id` e completionId mantida.
- Limites atuais mantidos: 30 palavras/sessão, 3 apresentações/card, resposta 300 chars.
- Kill switch `FLASHCARD_ACTIVE_RECALL_ENABLED` mantido + flags granulares por novo tipo para rollout.

## 9. Testes

- **Unit**: passos learning/relearning; fuzz determinístico; leech flag; migração v1→v2; fila diária (quota, interleaving, cap); persistência incremental + fallback no complete; desacoplamento conversa↔SRS; avaliação de frase com IA mockada + fallback.
- **E2E** (padrão `page.route` mockado): fluxo diário completo; sessão com frase + feedback; abandonar/retomar sem perder agendamento.

## 10. Fases

1. **PR A — Fundação SRS v2**: passos learning/relearning, fuzz, leech flag, persistência incremental, desacoplamento da conversa, migração aditiva, remoção de código morto. Sem mudança de UI.
2. **PR B — Fila diária**: endpoint de fila do dia, quotas, tela inicial nova, interleaving, integração home/palavras.
3. **PR C — Mix de tipos**: reativar produção/cloze/escuta com progressão por estágio, métricas por competência, micro-feedback de intervalo.
4. **PR D — Frases com IA**: `sentence_translation`, avaliação por IA com feedback, resultado enriquecido + streak diário.
5. **PR E — Estabilização**: scans com filtro server-side, telemetria dos novos fluxos, atualização dos docs desatualizados (`FLASHCARD_*`, build plan), rollout com flags.

## 11. Riscos

- **Teable sem transações**: gravação incremental aumenta o número de writes por sessão; mitigado por idempotência e fallback no complete.
- **Custo/latência da IA** na avaliação de frases: limitado a 1–3 cards/sessão, com timeout e fallback.
- **Regressão pedagógica** para usuários com agendamento v1: migração preserva estado; novos passos só na próxima transição.
