# Design: Avaliação binária de flashcards ("Não lembrei" / "Lembrei")

Data: 2026-08-06
Status: aprovado pelo usuário nas 3 seções (UX, arquitetura, auditoria)

## Contexto

A "Revisão inteligente" usa SRS v2 com 4 botões de autoavaliação (forgot / hard / good / easy).
Autoavaliação em 4 pontos é ruidosa e cansativa: o usuário hesita principalmente entre
hard/good/easy, e a pesquisa em aprendizado mostra que julgamentos metacognitivos de
aprendizado são pouco confiáveis. Em compensação, o app já coleta dois sinais objetivos por
apresentação: **correção da resposta digitada** (`AnswerMatch`) e **latência de resposta** —
medida implícita de fluência lexical bem estabelecida na pesquisa de aquisição de L2.

A lógica de mapeamento já existe em código: `suggestRecallRating`
(`lib/learning/flashcard-queue.ts:7-12`) infere a nota a partir de acerto + tempo. Hoje ela
apenas pré-seleciona um botão. Este design a promove a regra oficial de avaliação.

## Decisões aprovadas

1. **2 botões**: `Não lembrei` / `Lembrei`. A nota interna de 4 valores é inferida
   automaticamente (binário + tempo implícito).
2. **Desfazer simples**: botão "Desfazer" por ~5s após cada avaliação (padrão Anki),
   revertendo o estado da palavra no servidor.
3. **Auditoria completa** dos recursos de flashcard com testes de caracterização.

## Seção 1 — Experiência no card

- Fase de resposta inalterada: card pergunta, usuário digita (compreensão, produção, cloze,
  escuta) ou aperta "Não lembro".
- Após a resposta, dois botões grandes: `Não lembrei` e `Lembrei`, cada um com o próximo
  intervalo embaixo (ex.: "amanhã" / "em 16 dias").
- O intervalo exibido é **exato**, não estimativa: a resposta já aconteceu, então o servidor
  calcula o agendamento real com a nota inferida (hoje o preview ignora o tempo de resposta
  por ser desconhecido — ver `spaced-repetition.ts:142-143`).
- Microcopy discreta de transparência: "Resposta rápida — conta como Fácil",
  "Demorou um pouco — conta como Difícil", "Quase lá — conta como Difícil" (erro menor).
- "Desfazer" visível por ~5 segundos após avaliar: reverte a palavra ao estado anterior e
  devolve o card à fila da sessão.

## Seção 2 — Arquitetura

### Não muda

- `lib/learning/spaced-repetition.ts`: toda a matemática do SRS v2 (ease 1.3–2.8, lapses,
  passos de learning [1, 3], relearning, leech ≥ 4 lapses, fuzz ±10% ≥ 7 dias, estados).
- Modelo de dados: nenhuma migração de schema; as 4 notas internas continuam existindo.

### Muda

- `lib/learning/flashcard-queue.ts`
  - `suggestRecallRating` → renomear para `inferRecallRating` (semântica: regra, não dica).
  - Mapeamento (inalterado): `forgot` ou `incorrect` → forgot; `minor_error`/`unknown` →
    hard; acerto com `responseTimeMs <= 6s` (cloze: 10s) → easy; demais → good.
- Servidor — verificação de resposta (`lib/learning/flashcards.ts` + rota de resposta):
  - Ao checar a resposta digitada, calcula a nota inferida com o tempo real e devolve:
    - `inferredRating` + `explanation` ("fast" | "slow" | "minor_error" | null);
    - `intervals`: `{ forgot: number, remembered: number }` em dias, exatos, calculados via
      `calculateAdaptiveReview` com a tentativa real (rating + cardType + responseTimeMs).
  - O endpoint de avaliação passa a aceitar apenas a decisão binária
    (`remembered: boolean`); a nota gravada é `forgot` ou a nota inferida no momento da
    verificação da resposta.
- `components/FlashcardTrainer.tsx`:
  - Substitui o bloco de 4 botões pelos 2 botões com intervalos exatos.
  - Remove pré-seleção de sugestão e estado associado.
  - Adiciona fluxo de desfazer (toast/botão com janela de ~5s).
- Desfazer (servidor):
  - Na gravação da avaliação, persiste snapshot dos campos de revisão anteriores da palavra
    (junto ao log de tentativa).
  - Novo endpoint `undo`: restaura o snapshot e marca a tentativa como desfeita (o registro
    é mantido para auditoria, mas não conta para o agendamento). Falha com erro claro se a
    tentativa não for a mais recente da sessão ou se já houver avaliação posterior na mesma
    palavra. A janela de ~5s é enforceada no cliente; no servidor vale a regra acima.
  - Cliente: ao desfazer, recoloca o card na fila local (próxima posição elegível).

## Seção 3 — Auditoria completa + testes

1. **Linha de base**: rodar suítes existentes em `tests/unit` e `tests/e2e`.
2. **Testes de caracterização** (criar onde faltar):
   - Fila diária: vencidas até 23:59 no fuso do usuário; novas = `last_reviewed_at` vazio
     ordenadas por `first_used_at`; quota `max(0, quota - introduzidas hoje)`; só sessões
     `completed`/`active` consomem quota; interleaving; cap 30 e `remainingCount`.
   - Só difíceis: seleção (`difficult` ou leech), ordenação `lapse_count` desc +
     `review_due_at` asc, cap 30.
   - Sessão custom: critérios `least_used`/`oldest`, clamp 2–30, partição vencidas-primeiro
     (confirmar comportamento real vs. doc e registrar o correto).
   - Sessão: validação de respostas, 1–3 apresentações, reenfileiramento +3/+5,
     `rebuildFlashcardQueue` (retomada), sessões abandonadas.
   - SRS: graduação (7/15 dias), regraduação pós-lapse (×0.5/×0.75, piso 4 dias), clamps de
     ease, leech, fuzz determinístico com seed, `deriveReviewState` (4 gatilhos de
     `difficult`; `suspended` apenas preservado).
   - Novo fluxo: inferência de nota por tempo/tipo de card; intervalos exatos exibidos;
     desfazer (sucesso, janela expirada, avaliação posterior).
3. **Correções**: bugs claros de implementação são corrigidos no caminho; discrepâncias que
   mudem comportamento visível são reportadas antes de alterar.
4. **Relatório**: documento curto em `docs/` com o verificado, o que falhava e correções.

## Riscos / observações

- Usuário que digita devagar por motivo externo (distração) terá notas "hard" indevidas —
  mitigado pelo desfazer e pela autocorreção natural do SRS.
- Cards de escuta têm latência naturalmente maior; se a auditoria mostrar viés, ajustar o
  threshold por tipo de card (como já existe para cloze).
- A documentação de produto que descreve os 4 botões precisa ser atualizada após a mudança.
