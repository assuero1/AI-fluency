# Relatório de implementação — Flashcards PR 4

Data: 10 de julho de 2026

## Entrega

- Repetição espaçada adaptativa, determinística e versionada como `srs-v1`.
- Cada palavra recebe intervalo, facilidade, sequência, lapsos, última avaliação, tempo médio, estado, versão e próxima revisão.
- Avaliações `forgot`, `hard`, `good` e `easy` seguem regras distintas, com limites explícitos para facilidade e intervalo.
- O tempo de resposta influencia moderadamente o intervalo por tipo de card, sem alterar a correção da resposta.
- Tentativas múltiplas da mesma palavra são agregadas pelo pior resultado; um acerto fácil não apaga uma falha na mesma sessão.
- A atualização acontece somente na conclusão idempotente da sessão, usando as tentativas persistidas do PR3.
- Datas de revisão respeitam o calendário do fuso horário configurado pelo aprendiz.
- Dados antigos ou incompletos são normalizados de forma tolerante; palavras suspensas permanecem suspensas.

## Migração

`Words` recebeu os campos aditivos:

- `review_interval_days`, `review_ease`, `review_streak`, `lapse_count`;
- `last_reviewed_at`, `last_rating`, `average_response_time_ms`;
- `review_state`, `review_version`.

O migrador do Teable cria esses campos e suas opções de seleção de forma idempotente.

## Evidências

- 23 arquivos de teste e 90 testes unitários aprovados.
- Cobertura do algoritmo: primeira revisão, sequência de sucessos, lapsos, múltiplos cards, limites, tempo de resposta, timezone, dados legados e estado suspenso.
- TypeScript, ESLint, build e verificação de diff aprovados.
- Migração QA aplicada; a segunda execução não encontrou alteração pendente.
- Integração QA confirmou que a conclusão real persiste `reviewIntervalDays`, `reviewStreak`, `lastRating` e `reviewVersion`.
- 16 testes E2E, smoke test e limpeza integral do QA aprovados.

## Escopo de ambiente

O PR4 está 100% implementado e validado no QA. A promoção do schema para produção é um passo de deploy separado:

`node scripts/setup-teable-schema.mjs --env .env.local --apply`
