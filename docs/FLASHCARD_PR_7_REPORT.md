# Relatório de implementação — Flashcards PR 7

Data: 10 de julho de 2026

## Rollout e observabilidade

- Flag server-side `FLASHCARD_ACTIVE_RECALL_ENABLED`; use `false` para interromper novas sessões sem apagar histórico.
- Eventos auditáveis e sem resposta bruta para geração, retomada, abandono, tentativa, fallback de áudio, inconsistência e duplicidades bloqueadas.
- Tempos de geração e avaliação registrados; agregador calcula latências, taxas de falha/fallback, abandonos e bloqueios.
- Falhas externas de IA, Kokoro e Teable geram logs estruturados sem segredos ou conteúdo do aprendiz.
- Limites aplicados: até 30 palavras, no máximo três apresentações por card, resposta de 300 caracteres, timeout de IA e áudio, e IDs estritamente vinculados ao perfil ativo.
- Matriz determinística cobre sessões de 2, 5, 10 e 30 palavras e fallback quando a IA está indisponível.

## Evidências atuais

- TypeScript, 25 arquivos/93 testes unitários, lint, build, bundle sem segredos e diff check aprovados.
- Integração QA aprovada após a instrumentação final.
- O E2E final não iniciou porque o ambiente Codex atingiu o limite de uso. A última execução anterior aprovou 17 testes, mas precisa ser repetida sobre o estado final antes de declarar o PR7 100% fechado.

## Rollout recomendado

1. Habilitar a flag no QA e conferir uma sessão de 2, 5, 10 e 30 palavras.
2. Promover o schema aditivo e a flag para o perfil pessoal em produção.
3. Monitorar `flashcard_attempt_evaluated`, abandonos e fallbacks de áudio nas primeiras sessões.
