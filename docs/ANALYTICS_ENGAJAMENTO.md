# Analytics de engajamento — definições e alvos

**Ferramenta:** `node scripts/analytics-report.mjs --env .env.local` (usa a service-role key; seguro para rodar localmente). Fontes: `app_events`, `practice_sessions`, `users`, `push_subscriptions`. Janela padrão: 60 dias.

Este documento define cada métrica do relatório e as metas acordadas no [estudo de engajamento](../ESTUDO_ENGAJAMENTO_RETENCAO.md) (seção 6). **Baseline medido em 2026-09-03, antes de o Plano 1/2 chegarem aos usuários:**

| Métrica | Baseline (2026-09-03) | Alvo (90 dias pós-deploy) |
| --- | --- | --- |
| DAU médio (28d) | ~1,1 | ≥ 2,0 |
| Retenção D1 | 33% (1/3) | +30% vs baseline |
| Retenção D7 | 33% (1/3) | +30% vs baseline |
| Streak ≥ 7 dias | 0 de 4 usuários | dobrar a contagem absoluta |
| Opt-in de push | 0 | ≥ 40% dos ativos |
| Push → sessão | — | ≥ 8% de conversão |
| Sessões concluídas / abandonadas (flashcards) | 14 / 10 | ≥ 2:1 |
| CTR dos CTAs de fim de sessão | — (sem dados) | ≥ 25% das conclusões |

## Definições

- **Usuário ativo no dia**: tem qualquer `app_event` ou `practice_session` naquele dia local (fuso `America/Sao_Paulo`).
- **DAU médio (28d)**: média de usuários ativos por dia nos últimos 28 dias com atividade.
- **Retenção D1 / D7 (proxy)**: para cada usuário, seja D0 o primeiro dia ativo na janela; retenção = % que tem atividade em D0+1 (ou D0+7). Usuários com janela ainda aberta são excluídos do denominador.
- **Conclusão por modalidade**: `practice_sessions` com `status = completed` vs `abandoned`, por `type` (flashcards, new_words).
- **Distribuição de streak**: histograma de `users.current_streak` em baldes 0 / 1-6 / 7-29 / 30+.
- **Opt-in de push**: usuários com `reminder_hour` definido; assinaturas ativas contadas em `push_subscriptions`.
- **CTR dos CTAs de fim de sessão**: evento `cta_clicked` (com `payload.cta`) dividido pelo número de sessões concluídas da modalidade de origem. CTAs instrumentados:
  - `review_cards` — "Revisar em cards" (fim de palavras novas) e "Treinar as N palavras desta conversa" (resumo);
  - `chat_from_flashcards` — "Usar palavras em conversa" (resultado do treino).

## Como usar

Rode o relatório **antes** de cada deploy relevante e a cada ~2 semanas. Compare contra o baseline desta página; mudanças de 1 usuário pequeno são ruído — olhe a tendência de 2+ leituras.
