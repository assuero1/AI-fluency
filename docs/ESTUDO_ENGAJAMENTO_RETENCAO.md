# Estudo de Engajamento e Retenção — AI Fluency

**Data:** 2026-09-03
**Escopo:** melhorar significativamente a experiência, atratividade e "grudinho" do app **sem adicionar novas modalidades de aprendizado**. As três modalidades permanecem: **chat de conversação com IA**, **aprendizado de palavras novas** e **revisão inteligente (SRS)**. O estudo compara o app com as mecânicas comprovadas dos líderes de mercado (Duolingo, Speak, Anki, Babbel, Busuu) e propõe um roadmap priorizado.

---

## 1. Sumário executivo

O AI Fluency é **pedagogicamente superior à média**: tem um SRS próprio estilo SM-2 refinado (`srs-v2`), correção gramatical em contexto com explicação, feedback diário gerado por IA, TTS com karaoke palavra-a-palavra e um professor de IA consultável dentro da conversa. O que falta não é conteúdo nem inteligência — é a **camada emocional e de hábito** que faz os líderes prenderem usuários:

- **Zero celebração.** Os três fins de sessão (conversa, palavras novas, treino) são telas estáticas de números. O trophy do resultado não anima; o keyframe `bounce-in` já existe no CSS e nunca é usado.
- **Um único som no app inteiro** (click de botão no treino de palavras). **Zero vibração/haptics.** O momento de maior dopamina de um app de flashcards — o veredito acerto/erro — é apenas uma cor de texto.
- **Zero notificações.** Não existe web push, nem handler no service worker. O app não tem como chamar o usuário de volta.
- **Streak (sequência) frágil:** não é persistida, é recalculada a cada request; a Home conta só conversas enquanto o Progresso conta também treinos (inconsistência); não há streak freeze, marcos ou visualização no calendário.
- **Metas pela metade:** `weekly_conversation_goal` é salva e nunca exibida em lugar nenhum; não existe meta diária; a meta de mensagens da conversa termina com uma troca de cor de borda.
- **Progresso enganoso:** a barra de nível do Progresso é **estática e fake** (Iniciante=20%, B1=55%, Avançado=82% — hardcoded em `lib/learning/progress.ts:275-282`).

A boa notícia: **a fundação técnica para tudo isso já existe** — ~35 eventos em `app_events`, sessões com duração/placar, fila diária com contagem de devidas, design system "chunky" com keyframes prontos. A maioria das melhorias de maior impacto é **exibição e emoção sobre dados que o app já produz**.

### Top 10 recomendações (resumo)

| # | Recomendação | Prioridade | Esforço | Impacto esperado |
|---|---|---|---|---|
| R1 | Kit de micro-recompensas (sons, haptics, confetti, troféu animado, score count-up) | P0 | M | Alto — muda a sensação do app inteiro |
| R2 | Celebração de fim de sessão + "próximo passo" em destaque (fechar loops mortos) | P0 | M | Alto — transforma o fim em convite |
| R3 | Festejar a meta da conversa quando atingida (toast + confetti + CTA finalizar ali) | P0 | S | Médio/Alto |
| R4 | Streak robusta: persistir, contar as 3 modalidades, marcos, recorde pessoal, streak freeze, heatmap no calendário | P1 | M | Alto — é a mecânica nº 1 do Duolingo |
| R5 | Meta diária única + progresso do dia na Home | P1 | M | Alto |
| R6 | Missões diárias (2–3 quests rotativas sobre dados existentes) | P1 | M | Alto |
| R7 | Conquistas/badges com toast de desbloqueio | P1 | M | Médio/Alto |
| R8 | Loops entre modalidades: resumo → revisar palavras de hoje; fim de palavras → cards/conversa; badge de fila na bottom nav | P1 | S/M | Alto — multiplica sessões por visita |
| R9 | Notificações web push (opt-in, lembrete anti-perda de streak, copy escalonada) | P1 | L | Alto — é o gatilho externo do hábito |
| R10 | XP + nível real substituindo a barra fake; gráficos e heatmap em Progresso | P2 | M | Médio/Alto |

Roadmap detalhado na seção 5. Guarda de escopo (o que deliberadamente **não** faremos) na seção 4.5.

---

## 2. O que os melhores apps fazem (benchmarks)

### 2.1 Duolingo — o padrão-ouro de retenção por hábito

- **Streak é a mecânica central.** Usuários com sequência de 7 dias têm **3,6x mais chance** de permanecer engajados a longo prazo ([Orizon](https://www.orizon.co/blog/duolingos-gamification-secrets)). O próprio Duolingo documenta a ciência do hábito por trás da streak ([Duolingo Blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)).
- **Proteção da perda (loss aversion):** Streak Freeze e amuletos de fim de semana deixam o usuário "pausar" sem quebrar a sequência — medido como redução de churn ([StriveCloud](https://www.strivecloud.io/duolingo-gamification-explained), [Medium — breakdown do sistema](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f)). Marcos (ex.: recompensa a cada 25 dias) criam metas intermediárias ([Medium — gems e ligas](https://christinekoi.medium.com/7-tips-for-gems-and-leagues-on-duolingo-2025-0ed31cc362ef)).
- **Notificações cirúrgicas:** o lembrete de prática é enviado **23,5 horas** após a prática do dia anterior — de propósito, para chegar antes do streak quebrar ([Darewell](https://darewell.co/en/duolingo-streaks-retention-secret/)). Quando o usuário ignora, a copy escala de amigável para "passivo-agressiva" ("Esses lembretes não parecem estar funcionando…"), o que virou marketing viral ([Mashable — CEO do Duolingo](https://mashable.com/article/ceo-duolingo-notifications), [El País](https://english.elpais.com/lifestyle/2024-12-22/we-havent-seen-you-in-a-while-duolingos-passive-aggressive-strategy-for-keeping-users-hooked.html)). O case canônico do crescimento é [How Duolingo reignited user growth (Lenny's Newsletter)](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth).
- **Missões diárias e recompensas variáveis:** quests diárias diversificam o uso e desbloqueiam bônus de XP ([DuoPlanet](https://duoplanet.com/how-to-win-duolingo-league/)).
- **Anti-frustração:** em 2025 trocou Corações por **Energia** — errar não pune mais, recarrega com acertos seguidos; a justificativa oficial é sustentar hábito em vez de punir erro ([Duolingo Blog — Energy](https://blog.duolingo.com/duolingo-energy/)).
- **Cuidado com o excesso:** "streak creep" — gamificação que vira chantagem emocional gera backlash ([The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)). Nossa copy deve usar humor leve, não culpa pesada.

### 2.2 Speak — o padrão de conversa com IA (nosso segmento direto)

- **40% dos usuários mensais voltam todo dia** e passam **~20 min/dia** no app — retenção excepcional para o nicho ([The Information via LinkedIn](https://www.linkedin.com/posts/rashishrivastava98_how-ai-language-learning-app-speak-is-taking-activity-7394440610465792000-ubIa)).
- O diferencial declarado é **feedback em tempo real durante a fala**, não só a resposta do tutor ([speak.com](https://www.speak.com/)) — exatamente o nicho que nosso chat com correção em contexto já ocupa.
- **Live Roleplays** com áudio imersivo e situações da vida real ([Speak blog](https://www.speak.com/blog/live-roleplays)) — nosso modo "Simulação" é o análogo; o aprendizado é investir na sensação de imersão (voz, ambientação, feedback instantâneo), não em nova modalidade.
- ~US$100M ARR e US$1B de valuation mostram que **conversa com IA é produto sufficiente por si só** quando a experiência é viciante ([Speak — Series C](https://www.speak.com/blog/series-c)).

### 2.3 Anki — o padrão de SRS (e nossa vantagem sobre ele)

- Anki é a referência de retenção de vocabulário via repetição espaçada, mas tem **fricção e frieza altíssimas** — setup complexo, zero dopamine ([Vocabuo vs Anki](https://vocabuo.com/blog/vocabuo-vs-anki-which-vocabulary-app-actually-helps-you-remember-more/), [retrospectiva de 27 apps](https://www.reddit.com/r/languagelearning/comments/1p6ivuu/ive_used_27_appsprograms_in_8_years_of_language/)).
- Nosso `srs-v2` (`lib/learning/spaced-repetition.ts`) já implementa o essencial de SM-2 com refinamentos (fator de tempo de resposta, fuzz determinístico, estados derivados, leech, datas às 09:00 no fuso do usuário). **A oportunidade não é o algoritmo — é embrulhar o mesmo algoritmo em uma experiência prazerosa**, coisa que o Anki nunca fez.

### 2.4 Babbel e Busuu — o que aproveitar

- **Babbel:** Review Manager integrado ao curso — a revisão não é um módulo separado, é o próximo passo natural após qualquer lição. Lição: **toda sessão deve terminar oferecendo a revisão do que acabou de ser visto**.
- **Busuu:** correções pela comunidade de nativos é seu grande diferencial de engajamento ([Language App Guide](https://languageappguide.com/app-reviews/busuu-review/), [Taalhammer comparison](https://www.taalhammer.com/taalhammer-vs-duolingo-busuu-babbel-anki-lingq-which-language-learning-app-reaches-c1c2-in-english-fastest/)). Comunidade está fora de escopo, mas o *efeito psicológico* (seu esforço visto e validado por alguém) pode ser reproduzido **pelo professor de IA** elogiando especificamente o progresso da semana com exemplos reais do usuário.

### 2.5 A lição unificada

Retenção = **gatilho externo** (notificação no momento certo) + **ação fácil** (saber o que fazer em 1 toque) + **recompensa imediata variável** (juice, acerto, celebração) + **investimento visível** (progresso, streak, palavras acumuladas) + **perda evitada** (streak freeze, fila do dia). O AI Fluency já tem o "investimento" (banco de palavras real do usuário) e a "ação" (3 CTAs claros); praticamente não tem gatilho nem recompensa.

---

## 3. Diagnóstico do app hoje

### 3.1 O que já é forte (manter e usar como alavanca)

1. **SRS de nível Anki** com estados, recuperação de falhas dentro da sessão, undo, preview de intervalo exibido nos botões ("Difícil → 3 dias") e resultado com 8 métricas detalhadas.
2. **Correção em contexto** com original riscado → correção em pill verde → "Por que isso importa?" + TTS da explicação. Melhor que a média dos concorrentes.
3. **Imersão de áudio única:** karaoke palavra-a-palavra sincronizado, tocar a partir de qualquer palavra, equalizador animado, ditado contínuo com halo pulsante.
4. **Professor de IA** em painel separado — análogo ao tutor do Speak.
5. **Fila do dia inteligente** (cap 30, cota de novas, interleave determinístico, "Só difíceis", sessão custom) já exposta na intro do treino.
6. **~35 eventos instrumentados** em `app_events` (conversa concluída/abandonada, treino completo, palavra julgada…) — base pronta para quests, conquistas e analytics.
7. **Design system "chunky"** com botões 3D, cards com sombra sólida, keyframes `bounce-in`/`pop-in`/`flame-pulse` prontos e `prefers-reduced-motion` respeitado.

### 3.2 Lacunas, camada por camada

**A. Recompensa imediata ("juice") — quase nula**

| Achado | Onde |
|---|---|
| Nenhuma celebração no app; trophy dos resultados é um `<div>` estático; `bounce-in` existe e não é usado | `globals.css:2396,2481`, `NewWordsTrainer.tsx:432-452`, `FlashcardTrainer.tsx:254-273` |
| Som: 1 único click sintetizado, disparado no submit — não no veredito | `lib/client/ui-sound.ts`, `NewWordsTrainer.tsx:296` |
| Zero haptics (nenhum `navigator.vibrate` no repo) | grep "vibrate" = 0 resultados |
| Veredito acerto/erro é só cor de texto nos dois treinadores | `NewWordsTrainer.tsx:545-550`, `FlashcardTrainer.tsx:360-366` |
| Meta da conversa atingida = troca de cor de borda + texto | `ConversationGoalProgress.tsx:10-40`, `globals.css:1314-1316` |
| Correção aplicada no chat não gera nenhum micro-evento positivo | `ChatConversation.tsx:775-793` |
| Espera de preparo das palavras novas (15–40s, polling até ~100s) mostra só o label do botão | `NewWordsTrainer.tsx:29-33,529-531` |

**B. Hábito e retorno — gatilhos inexistentes**

| Achado | Onde |
|---|---|
| Nenhuma notificação push; `sw.js` não tem handlers `push`/`notificationclick`/`sync` | `public/sw.js` |
| Streak recalculada a cada request, nunca persistida; **Home ignora treinos e palavras novas** (só conversas), Progresso inclui treinos | `home.ts:91-96` vs `progress.ts:73-76`, `practice-activity.ts:14-42` |
| Sem streak freeze, sem marcos (7/30/100), sem recorde pessoal, sem visualização no calendário (dots neutros) | `calendario/page.tsx:42-73` |
| `weekly_conversation_goal` salva, validada, devolvida pela API — e nunca renderizada | `account.ts:79-80`, `preferences/route.ts:13-14` |
| Sem meta diária; a mais próxima é a meta de mensagens por conversa | `ConversationSetupDialog.tsx` |
| Banner "Mantenha sua sequência" some quando praticou — não existe "você fez X de Y hoje" pós-sessão | `HomeDashboard.tsx:164-186` |

**C. Progresso visível — números sem narrativa**

| Achado | Onde |
|---|---|
| Barra de nível **fake/estática** (20/55/82%) | `progress.ts:275-282` |
| Sem XP, pontos, conquistas, recordes; "conquista" = 0 matches no repo | — |
| Calendário sem heatmap de intensidade; streak não aparece nele | `calendario/page.tsx` |
| Sem gráficos de evolução (fluência, palavras/mês) — só pills e números | `progresso/page.tsx` |
| Níveis do app são só 3 rótulos estáticos | `levels.ts` |

**D. Fluxos quebrados (loops mortos)**

| Achado | Onde |
|---|---|
| Resumo pós-conversa **não** oferece revisar as N palavras salvas (que já entraram na fila do SRS!) nem "usar em conversa" | `app/resumo/page.tsx:128-135` |
| Fim de palavras novas oferece só "Aprender mais" / "Voltar" — o loop inverso ("usar em conversa") só existe no fim do treino | `NewWordsTrainer.tsx:432-452` vs `FlashcardTrainer.tsx:254-273` |
| BottomNav sem badge de fila pendente (dado `dueCount/newCount` já é calculado) | `BottomNav.tsx:8-14` |
| Meta de conversa atingida não sugere finalizar na hora (botão finalizar está longe do composer) | `ChatConversation.tsx` |
| "Sair" do treino de palavras novas **não confirma** (treino de cards e chat confirmam) — risco de perda | `NewWordsTrainer.tsx:459` |

**E. Bugs/inconsistências que minam a confiança**

| Achado | Onde |
|---|---|
| Feedback diário e buckets mensais usam **UTC**: prática às 22h no fuso de São Paulo cai no dia seguinte | `feedback.ts:658-660`, `progress.ts:249-267` |
| Fallback de timezone inconsistente (`UTC` vs `America/Sao_Paulo`) | `progress.ts:75`, `profile.ts:87` |
| Eventos gravados mas nunca agregados — nenhum dashboard/rollup | único read: `account.ts:214,248` |

---

## 4. Recomendações priorizadas

> Princípio guardião: **nenhuma mecânica punirá o usuário** (nada de corações/energia que bloqueiem uso) e **nenhuma copy usará culpa pesada** (humor leve, nunca "você falhou"). A "streak creep" do Duolingo é um anti-padrão a evitar ([The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)).

### P0 — Juice: fazer o app festejar (semana 1)

**R1. Kit de micro-recompensas transversal.**
- Expandir `lib/client/ui-sound.ts` em uma biblioteca pequena de sons sintetizados (sem assets novos): `correct` (arpejo ascendente curto), `wrong` (tom grave suave — nunca estridente), `sessionComplete` (fanfarra de 3 notas), `goalReached`, `streakMilestone`. Ganho baixo, respeitando o ÁudioContext já destravado no gesto do usuário.
- Haptics via `navigator.vibrate` (Android/Chrome PWA): 15ms no acerto, padrão curto no erro, padrão de celebração no fim de sessão. Guarda de feature-detect.
- Confetti em canvas puro (~100 linhas, sem dependência) nos fins de sessão e marcos de streak; troféu com `bounce-in` + score com **contagem animada** (count-up).
- Animação de "pill +1" ao aplicar cada correção no chat e ao salvar palavras no resumo.

**R2. Fim de sessão = festa + próximo passo.** Uniformizar os três fins de sessão num padrão: animação de entrada (troféu bounce-in + confetti proporcional ao score), score com count-up, e **um CTA primário de continuidade contextual**:
- Resumo → "Revisar as {N} palavras de hoje" (usa a fila já criada) + "Usar em conversa";
- Palavras novas → "Revisar em cards" + "Usar em conversa" (espelhar o que o treino já tem);
- Treino → manter "Usar palavras em conversa" (já excelente) e acrescentar destaque visual.
- Se streak subiu hoje: banner "🔥 Sequência: N dias" com flourish.

**R3. Momento da meta na conversa.** Ao atingir `target_user_message_count`: toast + confetti leve + som, e o próprio componente da meta ganha um botão "Finalizar com chave de ouro" que roda o fluxo de finalização dali mesmo.

**R4. Correção vira pontinho de progresso.** Cada correção aplicada no chat incrementa um contador visível com micro-animação ("3 correções aplicadas nesta conversa" com pill animada) — o usuário passa a *caçar* ser corrigido, em vez de temer.

### P1 — O laço do hábito (semanas 2–3)

**R5. Streak robusta e justa.**
- Corrigir a inconsistência: **contar as 3 modalidades** (conversa concluída, treino completo, sessão de palavras novas completa) na Home, igual ao Progresso.
- Persistir o estado da streak (tabela nova ou colunas em `users`: `current_streak`, `longest_streak`, `last_practice_day`, `freeze_used_on`) para baratear leitura e viabilizar freeze.
- **Marcos celebrados** (3, 7, 14, 30, 100, 365) com confetti + som + tela breve; **recorde pessoal** exibido junto ("Recorde: 12 dias").
- **Streak Freeze:** 1 por semana, automático ou com 1 toque no banner do dia seguinte ("Você ganhou um congelamento — sua sequência está salva"). É a mecânica de loss aversion com melhor custo/benefício do mercado.
- **Streak no calendário:** pintar os dias praticados com intensidade (heatmap estilo GitHub) e o número de sequência corrente no cabeçalho do mês.

**R6. Meta diária única e visível.** Uma meta simples escolhida no onboarding (leve/média/pesada ≈ 5/15/30 min ou equivalente em ações) que qualquer modalidade cumpre. A Home mostra um anel/barra do dia ("Hoje: 70% — faltam ~4 min") que **continua visível depois de cumprida, vira check verde com festa** e dispõe o dia como "concluído". Substitui o banner passivo atual.

**R7. Missões diárias (quests).** 2–3 por dia, geradas deterministicamente por usuário+data a partir de dados que já existem:
- "Acerte ≥80% num treino de cards" · "Use 3 palavras salvas numa conversa" (detectável via `word_occurrences`) · "Finalize 1 conversa" · "Aprenda 3 palavras novas" · "Zere a fila de hoje".
- Recompensa simbólica (ver R10 XP) + toast de conclusão. Os eventos em `app_events`/`practice_sessions` já dão o matériap-prima.

**R8. Conquistas.** ~15 badges de curva longa (1ª conversa, 10 conversas, 100 palavras, 7/30/100 dias, 90% num treino, 5 correções numa conversa, primeira simulação…). Toast ao desbloquear + página "Conquistas" no Perfil. Custo baixo, apelo alto, e aproveita `app_events`.

**R9. Fechar os loops entre telas.**
- Resumo: CTA primário "Revisar as {N} palavras de hoje" (deep-link para treino filtrado nas palavras da conversa — o endpoint de treino custom já existe).
- Palavras novas: resultado com "Revisar em cards" e "Usar em conversa".
- BottomNav: badge com contagem da fila do dia no ícone Palavras (`dueCount + newCount`, dado já calculado em `summarizeDailyQueue`).
- Adicionar modal de confirmação ao "Sair" do treino de palavras novas (paridade com cards/chat).

**R10. Notificações web push.** É o único item de infraestrutura nova (VAPID + agendador). Fase própria por causa disso. Escopo mínimo viável:
- Opt-in **contextual** (nunca no primeiro login): após concluir a 2ª sessão — "Quer que a gente te avise amanhã para manter a sequência?" (o prompt com framing de streak testou melhor no Duolingo — [WSJ](https://www.wsj.com/tech/personal-tech/duolingo-streaks-notifications-app-spanish-bc87d6e4)).
- 2–3 tipos apenas: lembrete anti-quebra de streak (enviado no horário habitual do usuário, idealmente ~23,5h após a prática — [Darewell](https://darewell.co/en/duolingo-streaks-retention-secret/)), "fila de hoje pronta" e marco de streak. Copy escalonada: amigável → saudosa → humor leve, sem culpa ([Mashable](https://mashable.com/article/ceo-duolingo-notifications)).
- Infra a decidir: `pg_cron`/Edge Functions no Supabase vs. cron no VPS/EasyPanel (atenção ao proxy de 7s e à rede de saída da VPS — já tivemos degradação); o `sw.js` precisaria dos handlers `push`/`notificationclick` + bump de `CACHE_NAME`.

### P2 — Progresso visível e polimento (semanas 4+)

**R11. XP simples + nível real.** Pontos por ação (conversa concluída, card acertado, palavra nova, correção aplicada) e **nível derivado de domínio real** (palavras consolidadas + fluência média), substituindo `levelProgress()` fake. A barra passa a ser honesta: "faltam ~20 palavras consolidadas para B1".

**R12. Gráficos e heatmap.** Progresso com 2 gráficos simples (SVG puro, sem lib): fluência últimos 30 dias e palavras/mês. Calendário com heatmap de intensidade (R5).

**R13. Onboarding em 3 passos + momento de conclusão.** Wizard curto com barra de progresso real, tela de "Perfil pronto!" com mascote + confetti e CTA imediato "Fazer minha 1ª conversa (1 min)". A primeira conversa guiada curta garante a primeira vitória rápido — o "time-to-aha" é o maior preditor de D1.

**R14. Espera com graça.** Durante o preparo das palavras novas (15–40s): mascote "preparando", frases rotativas de dica/curiosidade do idioma, barra de progresso indeterminada animada. Mesma moeda, menos abandono.

**R15. Analytics mínimos.** Agregações noturnas sobre `app_events`/`practice_sessions` para acompanhar: D1/D7/D30, taxa de conclusão por modalidade, distribuição de streak, opt-in e clique de push, CTR dos CTAs de fim de sessão. Sem isso não dá para saber se as mudanças funcionam.

### 4.5 O que deliberadamente NÃO faremos (guarda de escopo)

- **Novas modalidades de aprendizado** (vídeo, curso estruturado, comunidade) — fora por decisão do produto.
- **Ligas/leaderboards entre usuários e correções por comunidade** (estilo Duolingo/Busuu): exigem camada social que não existe; voltar como possível fase 5.
- **Corações/energia que bloqueiam uso:** punição por erro contraindica nosso SRS generoso.
- **Copy culpabilizante agressiva:** humor leve no máximo; risco de backlash documentado ([El País](https://english.elpais.com/lifestyle/2024-12-22/we-havent-seen-you-in-a-while-duolingos-passive-aggressive-strategy-for-keeping-users-hooked.html), [The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)).

---

## 5. Roadmap sugerido

| Fase | Conteúdo | Esforço | Dependências |
|---|---|---|---|
| **1. Juice (P0)** | R1 kit de recompensas · R2 fins de sessão · R3 meta da conversa · R4 contador de correções + fix do modal de saída de palavras novas (R9d) | ~1 semana | Nenhuma — só frontend + bump do `CACHE_NAME` |
| **2. Hábito (P1)** | R5 streak robusta (+fix UTC do feedback) · R6 meta diária · R7 quests · R8 conquistas · R9 loops e badge na nav | ~2 semanas | Migração leve no Supabase (streak persistida, conquistas) |
| **3. Push** | R10 web push + agendador + copy ladder | 1–1,5 semanas | Decisão de infra (Supabase cron vs VPS), chaves VAPID |
| **4. Progresso** | R11 XP/nível real · R12 gráficos/heatmap · R13 onboarding wizard · R14 espera com graça · R15 analytics | ~2 semanas | Fase 2 (streak/dados) |

Notas técnicas transversais:
- **Todo deploy com UI nova exige bump do `CACHE_NAME` em `public/sw.js`** — o PWA do celular fica preso na versão velha caso contrário (lição já registrada do projeto).
- Confetti/sons/haptics em módulo próprio com feature-detect e respeito a `prefers-reduced-motion` (o CSS já respeita).
- Corrigir o bug de fuso (UTC → timezone do usuário) **antes** de construir streak/quests sobre datas de feedback, senão as mecânicas herdarámo o bug.

---

## 6. Como medir sucesso

Baseline hoje: sem agregação de eventos, o primeiro passo é instrumentar (R15). Alvos sugeridos pós-implementação (90 dias):

| Métrica | Como medir | Alvo |
|---|---|---|
| Retenção D7 | usuários com 2ª sessão em 7 dias (app_events) | +30% vs baseline |
| Sessões por usuário ativo/dia | practice_sessions / DAU | ≥1,4 (loops fechando) |
| % de sessões que terminam em CTA de continuidade | cliques nos CTAs de fim | ≥25% |
| Distribuição de streak ≥7 dias | streak persistida | dobra |
| Opt-in de push / push→sessão | eventos de notificação | ≥40% opt-in, ≥8% conversão |
| Conclusão de meta diária | quests/meta diária | ≥50% dos dias ativos |

---

## 7. Fontes

- [Orizon — Duolingo's Gamification Secrets](https://www.orizon.co/blog/duolingos-gamification-secrets)
- [Duolingo Blog — How the streak builds habit](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)
- [Duolingo Blog — Energy](https://blog.duolingo.com/duolingo-energy/) · [DuoPlanet — Energy](https://duoplanet.com/duolingo-energy-system/)
- [StriveCloud — Duolingo gamification explained](https://www.strivecloud.io/duolingo-gamification-explained)
- [Medium — Duolingo streak system breakdown](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f)
- [Darewell — The secret behind Duolingo streaks (notificação 23,5h)](https://darewell.co/en/duolingo-streaks-retention-secret/)
- [WSJ — Duolingo streaks & notifications](https://www.wsj.com/tech/personal-tech/duolingo-streaks-notifications-app-spanish-bc87d6e4)
- [Mashable — CEO do Duolingo sobre notificações passivo-agressivas](https://mashable.com/article/ceo-duolingo-notifications)
- [El País — passive-aggressive strategy](https://english.elpais.com/lifestyle/2024-12-22/we-havent-seen-you-in-a-while-duolingos-passive-aggressive-strategy-for-keeping-users-hooked.html)
- [Lenny's Newsletter — How Duolingo reignited user growth](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)
- [DuoPlanet — Daily quests e ligas](https://duoplanet.com/how-to-win-duolingo-league/)
- [The Decision Lab — Streak creep](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)
- [Speak — site oficial](https://www.speak.com/) · [Speak — Live Roleplays](https://www.speak.com/blog/live-roleplays) · [Speak — Series C](https://www.speak.com/blog/series-c)
- [The Information via LinkedIn — métricas de retenção do Speak](https://www.linkedin.com/posts/rashishrivastava98_how-ai-language-learning-app-speak-is-taking-activity-7394440610465792000-ubIa)
- [Vocabuo vs Anki](https://vocabuo.com/blog/vocabuo-vs-anki-which-vocabulary-app-actually-helps-you-remember-more/)
- [Language App Guide — Busuu review](https://languageappguide.com/app-reviews/busuu-review/)
- [Taalhammer — comparação entre apps](https://www.taalhammer.com/taalhammer-vs-duolingo-busuu-babbel-anki-lingq-which-language-learning-app-reaches-c1c2-in-english-fastest/)
