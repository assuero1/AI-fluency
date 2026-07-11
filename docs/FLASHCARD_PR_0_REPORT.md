# Relatório de conclusão — Flashcards PR 0

Data: 10 de julho de 2026

## Escopo consolidado

- Contratos atuais compartilhados entre cliente e servidor.
- Seleção por menor uso e uso mais antigo caracterizada por testes.
- Quantidade limitada entre 2 e 30 e proporção palavra/frase caracterizadas.
- Baralho congelado na sessão com seed reproduzível.
- Respostas validadas contra `cardId` e `wordIds` do snapshot.
- Conclusão protegida por chave idempotente persistida.
- Chamadas concorrentes reunidas dentro da mesma instância do servidor.
- Atualização legada de familiaridade e próxima revisão caracterizada.
- Fluxo móvel coberto da criação ao resultado.

## Evidências automatizadas

- ESLint completo: aprovado.
- TypeScript: aprovado.
- Testes unitários: 19 arquivos e 66 testes aprovados.
- Build de produção: aprovado, incluindo `/palavras/treino` e as duas APIs.
- Integração QA: 25 verificações aprovadas; limpeza de todos os fixtures aprovada.
- E2E específico de flashcards em Pixel 5: aprovado.
- Matriz E2E final: 14 de 14 cenários aprovados em uma única execução.
- Matriz visual: aprovada em 320, 360, 375, 390 e 430 pixels, sem overflow horizontal nem navegação cortada.
- Verificação de segredos no bundle cliente: aprovada.
- Smoke de produção: aprovado.
- Ambiente QA verificado sem fixtures persistidos após a execução.
- Gate agregado `npm run test:release`: aprovado.

## Idempotência e limite arquitetural

O PR 0 garante reenvio idempotente pela mesma chave e impede duplicidade concorrente dentro de uma instância do servidor. O cliente Teable atual não expõe transação, compare-and-swap ou unicidade condicional; portanto, coordenação atômica entre duas instâncias diferentes pertence ao PR 3, que introduzirá tentativas e sessões auditáveis. Essa limitação não altera o comportamento legado consolidado pelo PR 0 e está registrada explicitamente para não criar uma promessa falsa de atomicidade distribuída.

## Compatibilidade

Sessões novas incluem snapshot verificável. Sessões antigas sem cards congelados são rejeitadas com orientação para iniciar novo treino, evitando contabilização baseada em dados não verificáveis enviados pelo navegador.

## Gate

O baseline técnico do PR 0 está pronto para servir de contrato ao PR 1. A separação em branch e commits permanece uma operação de publicação; não foi executada automaticamente para não incluir mudanças locais do usuário sem autorização explícita.
