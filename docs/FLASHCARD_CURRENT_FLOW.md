# Fluxo atual de flashcards

Este documento caracteriza a implementação existente antes da migração definida em `FLASHCARD_IMPLEMENTATION_PLAN.md`.

## Criação da sessão

1. O usuário escolhe entre `least_used` e `oldest` e solicita de 2 a 30 palavras.
2. O servidor limita a seleção ao usuário e ao perfil de idioma ativos.
3. `least_used` ordena por `total_uses` e desempata por menor `familiarity_score`.
4. `oldest` ordena por `last_used_at`, usando `first_used_at` como fallback.
5. A sessão é persistida em `PracticeSessions`; critério, palavras e quantidade de cards ficam serializados em `focus`.

## Construção do baralho

- Metade dos cards usa palavras isoladas; em quantidades ímpares, a palavra isolada recebe o card excedente.
- A outra metade tenta usar frases de até cinco palavras geradas em lote pela IA.
- Se a geração falhar ou produzir menos frases válidas, o card usa a palavra e sua tradução como fallback.
- O baralho é embaralhado no servidor com uma seed persistida e seu snapshot completo é congelado em `focus`.

## Interação e avaliação

- O usuário precisa digitar, falar ou escolher “Não lembro” antes de revelar a resposta.
- A comparação determinística sugere Não lembrei, Difícil, Lembrei ou Fácil, e o usuário pode alterar a sugestão.
- Respostas digitadas e transcritas seguem o mesmo fluxo e são enviadas em lote ao finalizar o último card.
- Cards avaliados como Não lembrei ou Difícil retornam dentro da sessão, no máximo três vezes.
- A retomada persistente pertence aos PRs seguintes.

## Atualização de familiaridade

- Cada acerto soma 1 e cada erro subtrai 1,5 por palavra associada ao card.
- `familiarity_score` é limitado ao intervalo de 0 a 10.
- Uma palavra com erro volta em 1 dia; sem erro, volta em 3, 7 ou 14 dias conforme a familiaridade resultante.

## Resultado e proteção contra duplicidade

- A nota é a porcentagem de cards marcados como corretos.
- O resultado apresenta acertos, erros e quantidade de palavras revisadas.
- A conclusão grava `completed`, `score` e `completedAt` em `focus`.
- Cada conclusão recebe `clientCompletionId`; um reenvio com a mesma chave retorna o resultado persistido sem reaplicar familiaridade.
- Uma conclusão diferente após a contabilização retorna conflito.
- Chamadas concorrentes da mesma sessão são reunidas por uma trava no processo do servidor.

## Limites conhecidos antes do PR 1

- Os cards ficam no snapshot da sessão, mas ainda não são registros individuais auditáveis.
- A trava concorrente do PR 0 protege uma instância do servidor; coordenação distribuída entre instâncias depende das entidades persistentes previstas no PR 3.
- Métricas dependem do lote enviado pelo navegador.
- Sessões criadas antes do snapshot não podem ser concluídas pelo contrato endurecido e precisam ser reiniciadas.
