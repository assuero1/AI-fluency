# Relatório de implementação — Flashcards PR 2

Data: 10 de julho de 2026

## Implementado

- Avaliações `forgot`, `hard`, `good` e `easy`, apresentadas como Não lembrei, Difícil, Lembrei e Fácil.
- Sugestão automática baseada na comparação, ausência de tentativa, tipo do card e tempo de resposta.
- Usuário pode alterar qualquer sugestão antes de avançar.
- Fila com `cardId`, `presentationNumber` e `dueAfterIndex`.
- Não lembrei reaparece após três outras apresentações; Difícil, após cinco.
- Lembrei e Fácil não retornam na sessão.
- Limite rígido de três apresentações por card e término garantido da fila.
- Espaçamento comprimido de forma determinística quando o baralho não possui cards suficientes para cumprir o intervalo integral.
- Barra diferencia cards únicos de apresentações.
- Resultado separa cards únicos, apresentações, acertos na primeira tentativa e cards recuperados.
- Servidor valida de uma a três apresentações sequenciais por card e recalcula a correspondência.
- Aproximadamente metade do baralho usa contexto a partir de quatro cards.

## Frases contextuais

- Uma chamada em lote, com timeout de oito segundos.
- Nível do aluno incluído no pedido de geração.
- Máximo de cinco palavras lexicais.
- Primeiro `word_id` define inequivocamente a palavra-alvo.
- Exatamente uma ocorrência da palavra-alvo.
- No máximo um ID de apoio e uma palavra lexical nova.
- Tradução obrigatória, IDs existentes, frases duplicadas e conteúdo técnico rejeitados.
- Itens inválidos são descartados individualmente.
- Falha ou geração parcial produz cards simples, indicação discreta na interface e evento técnico.
- Baralho final permanece pré-gerado e congelado na sessão.

## Evidências concluídas

- TypeScript, ESLint e build de produção aprovados.
- 21 arquivos e 77 testes unitários aprovados.
- Testes cobrem atrasos de três e cinco apresentações, limite de três, término da fila, sugestões, validação parcial de frases e métricas de recuperação.
- Dois E2E específicos de flashcards aprovados, incluindo reapresentação e envio de três apresentações para dois cards únicos.

## Evidências de release

- Gate agregado `npm run test:release`: aprovado.
- Suíte E2E completa: 15 de 15 cenários aprovados em Chromium móvel.
- Matriz visual aprovada em 320, 360, 375, 390 e 430 pixels, sem overflow horizontal nem navegação cortada.
- Integração QA: 25 verificações aprovadas e limpeza dos fixtures confirmada.
- Verificação de segredos do bundle cliente: aprovada.
- Smoke de produção: aprovado.
- Ambiente QA confirmado sem fixtures residuais.

## Conclusão

O PR 2 está 100% implementado e validado contra os critérios de aceite definidos no plano.
