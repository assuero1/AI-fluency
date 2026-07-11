# Relatório de implementação — Flashcards PR 3

Data: 10 de julho de 2026

## Implementado

- Migração aditiva para `Flashcards` e `FlashcardAttempts`.
- Evolução completa de `PracticeSessions` com status, duração, configuração e métricas.
- Cards congelados em registros individuais, ordenados por `initial_position`.
- Tentativa persistida imediatamente antes de avançar a fila.
- `client_attempt_id` idempotente e trava concorrente por sessão/card/apresentação.
- Comparação, normalização e sugestão recalculadas no servidor.
- Conclusão derivada prioritariamente das tentativas persistidas.
- Status `preparing`, `active`, `completed` e `failed` integrado ao fluxo.
- Consulta de sessão ativa e reconstrução determinística da fila.
- Interface oferece “Continuar treino” ao reabrir `/palavras/treino`.
- Exportação pessoal atualizada para schema 2, incluindo cards e tentativas.
- Exclusão, backup, recuperação e limpeza QA atualizados para as novas tabelas.
- Compatibilidade de leitura/conclusão preservada para sessões antigas baseadas em snapshot.

## Evidências

- TypeScript, ESLint, build e validação de sintaxe dos scripts aprovados.
- 22 arquivos e 81 testes unitários aprovados.
- Testes cobrem persistência normalizada, reenvio idempotente, reconstrução da próxima apresentação e contratos das APIs.
- 16 testes E2E aprovados, incluindo retomada de sessão ativa.
- Migração QA aplicada para as 15 tabelas; uma segunda execução não encontrou nenhuma alteração pendente, comprovando a idempotência.
- Integração QA executou o fluxo real de criação, respostas persistidas, conclusão, exportação e limpeza.
- Smoke test aprovado e `qa:verify-empty` confirmou que nenhuma fixture persistida ficou no QA.
- O gate de release aprovou lint, typecheck, testes unitários, build, varredura de segredos do bundle e integração QA.

## Escopo de ambiente

O PR 3 está 100% implementado e validado no ambiente QA. A migração aditiva do ambiente local/produção não foi aplicada neste trabalho, pois é uma ação de deploy separada. Quando for promovida, use:

`node scripts/setup-teable-schema.mjs --env .env.local --apply`

Após isso, valide o ambiente promovido pelo mesmo gate de release.
