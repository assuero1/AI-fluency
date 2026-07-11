# Relatório de implementação — Flashcards PR 1

Data: 10 de julho de 2026

## Implementado

- Modelo de card de recuperação ativa com `target_to_native`, `native_to_target`, `cloze` e reserva para `listening`.
- Distribuição inicial de 25% compreensão, 40% produção e 35% lacuna, com regras específicas para dois e três cards.
- Fallback de produção quando não há tradução e fallback de lacuna quando não há frase válida.
- Tentativa obrigatória antes da revelação; a resposta esperada não é renderizada previamente no DOM.
- Envio por Enter, ação “Não lembro”, bloqueio depois do envio e foco no campo do card seguinte.
- Transcrição nativa editável, sem envio automático, usando português ou o idioma estudado conforme a direção do card.
- Normalização Unicode NFC, caixa, espaços, pontuação periférica, apóstrofos equivalentes e sinais invertidos.
- Classificação `exact`, `acceptable`, `minor_error`, `incorrect` e `unknown`.
- Acentos semanticamente relevantes não recebem equivalência completa.
- Sugestão automática com confirmação manual do usuário.
- Comparação recalculada no servidor contra o snapshot congelado; `matchResult` do cliente não é confiado.
- “Não lembro” não pode ser contabilizado como acerto pelo contrato da API.

## Evidências concluídas

- ESLint: aprovado.
- TypeScript: aprovado.
- Testes unitários: 20 arquivos e 70 testes aprovados.
- Build de produção: aprovado.
- Testes novos cobrem normalização, alternativas, acentos, artigos, respostas abertas, distribuição, tentativa vazia, “Não lembro” e recálculo server-side.

## Evidências de release

- Os dois E2E específicos passaram: resposta digitada/Enter/“Não lembro” e voz editável sem envio automático.
- Suíte E2E completa: 15 de 15 cenários aprovados em Chromium móvel.
- Matriz visual aprovada em 320, 360, 375, 390 e 430 pixels, sem overflow horizontal nem navegação cortada.
- Integração QA: 25 verificações aprovadas e limpeza dos fixtures confirmada.
- Verificação de segredos do bundle cliente: aprovada.
- Smoke de produção: aprovado.
- Ambiente QA confirmado sem fixtures residuais.
- Gate agregado `npm run test:release`: aprovado.

## Conclusão

O PR 1 está 100% implementado e validado contra os critérios de aceite definidos no plano. Análise linguística adicional por IA continua sendo um aprimoramento opcional para respostas `unknown`; a indisponibilidade dessa análise não bloqueia a confirmação manual, como exige o fluxo de fallback.
