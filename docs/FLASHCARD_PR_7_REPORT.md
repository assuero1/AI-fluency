# Relatório de implementação — Flashcards PR 7

Data: 10 de julho de 2026

## Rollout e observabilidade

- Flag server-side `FLASHCARD_ACTIVE_RECALL_ENABLED`; use `false` para interromper novas sessões sem apagar histórico.
- Eventos auditáveis e sem resposta bruta para tentativas avaliadas e fallback de áudio.
- Limites já aplicados: até 30 palavras, até três apresentações, resposta limitada e fila persistida validada no servidor.

## Rollout recomendado

1. Habilitar a flag no QA e conferir uma sessão de 2, 5, 10 e 30 palavras.
2. Promover o schema aditivo e a flag para o perfil pessoal em produção.
3. Monitorar `flashcard_attempt_evaluated`, abandonos e fallbacks de áudio nas primeiras sessões.
