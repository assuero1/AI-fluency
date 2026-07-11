# Relatório de implementação — Flashcards PR 5

Data: 10 de julho de 2026

## Entrega

- Cards de escuta entram na distribuição do baralho quando o áudio do perfil está habilitado, em proporção aproximada de 15% para baralhos maiores.
- Card auditivo não mostra o texto antes da interação; o áudio só toca por ação explícita da pessoa.
- Reprodução normal e reduzida (0,75x), com fallback para a voz do dispositivo quando Kokoro não responde.
- Falha total do áudio revela um modo textual; tentativas auditivas marcadas com falha técnica não alteram o domínio da palavra.
- Cada tentativa registra contagem de reproduções, uso de velocidade reduzida, resposta após repetição e falha de áudio.
- Sessão ativa agora abre um modal com ações de continuar, reiniciar ou abandonar. Sair durante o treino exige confirmação.
- Abandono preserva o histórico auditável e não atualiza palavras ainda não concluídas.
- Resultado oferece retreinos vinculados por `parent_session_id`: erradas, difíceis, produção e escuta, além do atalho para conversa.

## Migração

`FlashcardAttempts` recebeu os campos aditivos:

- `used_slow_audio`;
- `answered_after_audio_replay`;
- `audio_failed`.

## Evidências

- TypeScript, 90 testes unitários, ESLint, build e verificação de diff aprovados.
- 17 testes E2E aprovados, incluindo card auditivo sem reprodução automática.
- Migração QA aplicada para os campos novos de telemetria.
- Integração QA confirmou exportação dos campos de telemetria após uma tentativa real.
- Verificação de segredos do bundle, smoke e limpeza do QA aprovados.

## Escopo de ambiente

O PR5 está implementado e validado no QA. A promoção do schema para produção é um passo de deploy separado:

`node scripts/setup-teable-schema.mjs --env .env.local --apply`
