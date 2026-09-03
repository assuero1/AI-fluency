# Plano de Refinamento de UI/UX — AI Fluency

**Data:** 2026-09-03 · **Base:** auditoria visual (20 screenshots em viewport 390×844 via ambiente QA com fixture) + auditoria de código (todas as páginas e componentes estruturais) · **Screenshots de referência:** `.playwright-mcp/audit/`

## Objetivo e princípios

Refinar o acabamento de todas as telas **mantendo intactos o estilo e a paleta**: o idioma visual "chunky" inspirado no Duolingo (botões 3D com sombra sólida, bordas 2px, Nunito pesada, cantos generosos, cores por seção) continua sendo a identidade. O trabalho é de **disciplina**: um só sistema de tokens, um só padrão por tipo de componente, e corte de informação redundante.

Regras que guiam todas as decisões:

1. **Um elemento = uma função.** Streak, nível, duração, CTA de prática: cada um aparece **no máximo 1× por tela**, sempre no mesmo lugar do app.
2. **Gradiente e 3D são a assinatura** (card de entrada do treino, faces do flashcard, troféus). Tudo ao redor fica quieto: cards planos, sem gradientes secundários.
3. **Todo valor visual vem de token.** Nada de hex, px de raio/Ícone/espaçamento soltos em componentes.
4. **Palavra é ação.** Botão diz o que acontece; verbos idênticos para ações idênticas em todo o app.

## O que fica como está (identidade validada)

- Paleta por seção (verde=home, azul=chat, roxo=palavras/novas, laranja=calendário, amarelo=progresso) com tons deep/soft e o mecanismo `.section-*` no `.phone-shell`.
- Botões chunky (`box-shadow: 0 4px 0`, `translateY(4px)` no active), `ButtonFeedback`, animações pop-in/bounce, skeletons shimmer, dots de loading.
- Phone shell 430px + bottom nav de 5 itens com blur.
- Tela de login/onboarding visual (mascote, tabs, fundo com radiais suaves) — só ajuste fino de ritmo.
- Heatmap do calendário, composer do chat com mic/send, FAB do professor.

---

## Parte 1 — Diagnóstico consolidado

### 1.1 Problemas sistêmicos (todas as telas)

| # | Problema | Evidência |
|---|----------|-----------|
| S1 | **Tokens definidos e ignorados**: `--radius-lg/md` existem mas há 13 valores de raio (4–32px) hardcoded; fontes de 11 a 52px sem escala; 14 pesos diferentes (600–900); ícones em ~14 tamanhos (13–34px) | `globals.css` inteiro; ex.: `globals.css:2327` (raio 24), `:2340` (32), `:2316` (18) |
| S2 | **Header de tela com 4 padrões**: `ScreenHeader` com pill de streak (6 telas); header centered embutido em row (chat); `top-row` manual com `h1` (resumo); `outline-button` + Pill como "título" (connections, onboarding idioma); hero custom (word detail, dia do calendário, intros dos trainers) | `app/resumo/page.tsx:77-83`, `app/settings/connections/page.tsx:66-75`, `app/palavras/[wordId]/page.tsx:32-43`, `app/calendario/[date]/page.tsx:30-36` |
| S3 | **Botão voltar com 4 estilos** — inclusive um com `ArrowRight` (ícone de avançar) em botão de voltar | `app/perfil/conquistas/page.tsx:41-43`, `app/settings/connections/page.tsx:67`, `components/NewWordsTrainer.tsx:474` |
| S4 | **Streak renderizado de 6 formas** (Pill+Flame20, Pill+Flame18, pill cru+Flame16, Pill+Flame16, texto+Flame13 inline, emoji 🔥) e duplicado dentro da mesma tela (home: header + card Hoje; progresso: header + seção Sequência) | `ScreenHeader.tsx:33`, `ChatConversation.tsx:611`, `HomeTodayCard.tsx:24`, `progresso/page.tsx:161`, `calendario/page.tsx:38`, `ProfilePreferences.tsx:222` |
| S5 | **Espaçamento vertical irregular**: `.section` usa 34px, mas marginTop inline 12/14/16/18/20/22 por toda parte; divisores com margem negativa convivem com divisores inline `34×1` | `HomeDashboard.tsx:171,219,237,271,285,301`, `palavras/page.tsx:50`, `calendario/page.tsx:45`, `progresso/page.tsx:125` |
| S6 | **Cores hardcoded fora dos tokens**: `#2f9d4a` (verde legado), `#f59d1f`, `#217a38`, `#2f7edb`, `#ef6b57`, bolha IA `#f8f5ee`, gradiente fixo `#173f2a→#2f9d4a`; blocos de "recolor de seção" empilhados como patches no fim do `globals.css` | `ListRow.tsx:30`, `WordPracticeButton.tsx:36`, `calendario/page.tsx:85,96`, `ProfilePreferences.tsx:293,323,343`, `globals.css:2443-2465` |
| S7 | **>8 anatomias de card** para o mesmo papel (settings-card, soft-card, topic-card, choice-card, calendar-feedback-card, word-sense-item, flashcard-attempt, vocabulary-option) com paddings de 14 a 34px e raios de 16 a 32 | `globals.css:1023-1104`, `1948-2007` |
| S8 | **5 grids de métricas diferentes** (metric-grid, word-summary, word-detail-metrics, calendar-score-grid, flashcard-result-grid) com anatomias de célula distintas | `globals.css:426-487`, `658-663`, `885-912`, `1897-1928`, `2398-2403` |
| S9 | **Modais com 2 implementações**: `ModalDialog` acessível (focus trap) vs `modal-backdrop` manual sem trap | `NewWordsTrainer.tsx:514,534`, `FlashcardTrainer.tsx:346,353`, `MilestoneModal.tsx:16` |
| S10 | **Empty states com 5 composições** (com botão dark, com ícone 30, ícone 32, com 2 botões, sem nada) | `chat/page.tsx:31-37`, `palavras/page.tsx:105-109`, `calendario/page.tsx:112-116`, `resumo/page.tsx:149-160` |
| S11 | **Emoji e ícone lucide misturados** para o mesmo significado (🔥/Flame, 🎉/Trophy, 🔔/Bell) | `HomeDashboard.tsx:156`, `MilestoneModal.tsx:19`, `PushOptInCard.tsx:62` |
| S12 | **Componente `Pill` contornado** por `<span className="pill ...">` cru; `IconBubble` fixo em 31px (fora de grid) | `HomeTodayCard.tsx:24`, `palavras/page.tsx:75`, `IconBubble.tsx:16` |
| S13 | **Labels divergentes para a mesma ação** ("Ver calendário/Ver tudo/Ver todas/Ver mais temas sugeridos") | `HomeDashboard.tsx:234,272,282,298` |
| S14 | **Classes Tailwind mortas** (Tailwind não instalado) e wrappers duplicados | `app/perfil/page.tsx:19,22` |

### 1.2 Redundâncias de conteúdo (UX) por tela

- **Home** — a tela mais carregada (10+ seções):
  - 4 caminhos de "iniciar prática" empilhados: "Fazer minha prática" (card Hoje), "Começar com este tema", "Começar" por sugestão, "Iniciar conversa livre" + botão-ícone de digitar (`HomeDashboard.tsx:329-336`).
  - Streak 3× na mesma visualização (header, card Hoje, texto motivacional).
  - "Meta semanal de palavras" duplica a tela Palavras; "Correções aplicadas" duplica Progresso/Resumo.
  - Anatomia das 3 métricas de feedback difere das métricas de palavras (números à esquerda vs. ícone acima).
- **Chat** — pill de streak + timer + "Sair" chunky (peso visual de ação destrutiva) no header; título clampado quebrado ("…sa / com a IA"); ícone de Volume2 em **vermelho danger** no tópico; CTA "Finalizar conversa" duplicado (botão verde + "chave de ouro" no `ConversationGoalProgress.tsx:59`); bolhas a 21px (texto maior que qualquer body do app).
- **Palavras** — métricas duplicadas na própria tela ("para revisar" e "novas" aparecem no summary `:47,51` e de novo nos review-states `:59,62`); 2 CTAs de treino empilhados (entrada topo + "Praticar palavras fracas" no rodapé); 6 tiles de distribuição que poderiam ser 1 linha.
- **Treino** — resultado com 8 métricas de detalhe + score repetido (título e barra); 4-5 CTAs no fim; texto "Como funciona" de 3 linhas; copy com jargão ("tentativas ficam **auditáveis**").
- **Novas** — subtítulo de intro longo (2 frases); modais de saída/retomada sem `ModalDialog`.
- **Detalhe da palavra** — pills quebram linha e expõem "87/100" cru; header fora do padrão.
- **Calendário (dia)** — duração do dia exibida 2× (pill do título da seção + pill por conversa, `[date]:89,100`); header custom divergente.
- **Progresso** — nível duplicado ("B1" gigante + "Intermediário (B1)"); streak duplicado; "B1" em cor escura fora da seção.
- **Resumo** — palavras aparecem 3× (pills do feedback, VocabularyPicker, "Já salvas"); 3 blocos de CTA empilhados; header manual.
- **Perfil** — streak como emoji 🔥 em texto corrido; mesma configuração "estilo de correção" com UI diferente no onboarding (pills) e no perfil (choice-cards).
- **Connections** — header invertido (Pill pequeno como título, `h1` gigante embaixo); 2 botões de voltar (topo + rodapé); card com override inline `background:#fff` sobre `.soft-card` (`page.tsx:36`).
- **Onboarding** — help "Usado para criar temas, feedbacks e correções." repetido em **todos** os cards de objetivo (`OnboardingForm.tsx:289`); CTA primário muda de cor entre etapas (dark) e celebração (green).

---

## Parte 2 — Sistema alvo (tokens e componentes)

### 2.1 Tokens no `:root` do `globals.css`

```css
/* Espaço (escala 4px) */
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
--space-section: var(--space-8);   /* entre seções (era 34) */
--card-pad: var(--space-5);        /* padding interno de card (era 14–34) */

/* Raios — só estes valores existem no app */
--radius-xs: 8px;   /* highlight de palavra, chips internos */
--radius-sm: 12px;  /* botões compactos, sub-cards, alertas */
--radius-md: 16px;  /* botões chunky, inputs, steppers, tradução */
--radius-lg: 24px;  /* cards de tela, modais, bolhas, composer */
--radius-xl: 32px;  /* só o hero: faces do flashcard / active-recall */
--radius-pill: 999px;

/* Tipografia (Nunito — pesos permitidos: 600/700/800/900) */
/* display 31/900 · section-title 20/800 · row-title 18/800 · body 16/700
   meta 14/600 · caption 12/700 · eyebrow 12/800 caps · word-big 52/900 (assinatura) */

/* Ícones lucide — só: 16 (inline/pills) · 20 (rows/links/back) · 24 (ações) · 28 (IconBubble, empty) · 32 (hero/métrica grande) */

/* Cores novas */
--streak: #f59d1f;          /* única cor da chama (hoje hardcoded em 2 lugares) */
--surface-muted: #f8f5ee;   /* bolha da IA (hoje hex solto) */
```

Mapeamento das mudanças que os tokens provocam: `.section` 34→32; `.title` 31/850→**900**; `.section-title` 21/820→20/800; `.row-title` 21/820→**18/800**; `.row-meta` 16→14/600; `.bubble` 21→18/700, padding 22→18, raio 28→24; `.composer` raio 28→24; `.soft-card`/`.settings-card`/`.topic-card`/`.calendar-feedback-card` → raio 24, padding 20; `IconBubble` 31→28.

### 2.2 Componentes base (criar/unificar)

| Componente | Função | Substitui |
|---|---|---|
| `ScreenHeader` (evoluir) | Header padrão de toda tela. Props: `title`, `subtitle?`, `streak?` (renderiza `StreakPill`), `centered?` | headers manuais de resumo, connections, onboarding-idioma |
| `StreakPill` (novo) | `Pill` + `Flame size=16` cor `var(--streak)`. Única renderização de streak do app | 6 variações atuais |
| `BackButton` (novo) | `ChevronLeft 20` + label 16/800 cor `var(--section-text)`. Usado em toda tela de detalhe | 4 estilos atuais (corrige `ArrowRight` das conquistas) |
| `Card` (classe base `.card`) | `border:2px solid var(--line); radius: var(--radius-lg); bg:#fff; padding: var(--card-pad); shadow 0 3px 0 rgba(31,25,16,.05)` + variantes `.card-soft` (fundo section-soft, sem borda) e `.card-flat` (sem sombra) | 8 anatomias S7 |
| `MetricGrid` (evoluir) | Variante `bordered` (células com divisórias) absorve word-detail-metrics, calendar-score-grid, flashcard-result-grid, word-summary | 5 grids S8 |
| `ModalDialog` | Passa a ser usado por **todos** os modais (sair/retomar dos trainers, Milestone) | backdrops manuais S9 |
| `EmptyState` (novo) | IconBubble 28 + título 18/800 + meta 15/600 + CTA verde opcional | 5 composições S10 |
| `SectionHeader` (novo) | `section-title` + `link-action` opcional à direita; padroniza "Ver tudo" | S13 |
| `Pill` | Componente usado em 100% dos casos (fim dos spans crus) | S12 |

**Semântica de botões (fixada em `docs/PADRAO_UI.md`):** `green-button` = iniciar/continuar prática e submit (ação primária, máx. 1 por tela) · `dark-button` = confirmação neutra em modais · `outline-button` = secundário · `danger-button` = destrutivo · ícone-ghost 44px = sair/fechar. Onboarding troca `dark-button` dos passos por `green-button` (consistência com celebração/login).

---

## Parte 3 — Execução por fases

### Fase 0 — Fundação de tokens (meio dia)

1. Adicionar os tokens de §2.1 ao `:root`; apontar as classes existentes para eles (mudança de valores é mínima: 34→32, 21→20 etc.).
2. Criar `docs/PADRAO_UI.md` com a tabela de tokens, semântica de botões, e as regras "streak ≤1/tela, CTA primário ≤1/tela, sem hex em tsx, ícones da escala".
3. **Critério de aceite:** app visualmente idêntico aos screenshots de referência (diff visual só nas mudanças intencionais de 1–2px); `lint+typecheck+unit+build` verdes.

### Fase 1 — Componentes base e saneamento de CSS (1–1,5 dia)

1. `ScreenHeader` + `StreakPill` + `BackButton` + `SectionHeader` + `EmptyState` + `Card`; trocar os usos página a página (S2, S3, S4, S7, S10, S13).
2. Todos os modais → `ModalDialog` (S9).
3. Saneamento do `globals.css`:
   - Consolidar os blocos de patch ("Recolors de seção", "QA visual") **dentro** das regras originais; remover duplicações (`globals.css:2443-2465`, `2634-2664`).
   - Substituir hex por tokens em tsx (S6) — `grep -rn '#[0-9a-fA-F]\{6\}' components app --include='*.tsx'` volta vazio (exceções documentadas: mascote SVG).
   - Eliminar estilos inline de layout (S5, S14) movendo para classes utilitárias do próprio globals (`.mt-*` não; criar classes semânticas por seção).
   - `IconBubble` 31→28; ícones fora da escala → valor mais próximo da escala (S1).
4. **Critério de aceite:** mesmas telas, agora 100% tokenizadas; zero hex/layout-inline nos greps do PADRAO_UI; e2e verdes (ajustar seletores se algum teste depende de classe).

### Fase 2 — Corte de redundância e copy (1 dia)

Mudanças de conteúdo por tela (mantém layout, corta duplicação):

- **Home:** streak só no `ScreenHeader` (pill do card Hoje vira texto motivacional sem pill); rodapé "Suas palavras" perde os botões "Iniciar conversa livre"/"Digitar conversa" (viram 1 link "ou inicie uma conversa livre →" dentro da seção de tema); "Meta semanal" sai da home (pertence a Palavras); métricas de feedback usam `MetricGrid` padrão.
- **Chat:** streak fora do header (fica só na home/progresso); "Sair" → ícone-ghost X 44px; título "Conversa" + subtitle "com a IA" em 16/600 (mata o clamp); ícone do tópico Volume2 danger→section; um único CTA de finalizar (o botão verde; "chave de ouro" do goal vira texto do bloco de meta).
- **Palavras:** remover tiles duplicados — `word-review-states` (6 tiles) → **barra segmentada única** (segmentos na cor da seção com contagens no acessível) ou linha de 3 chips; remover "Praticar palavras fracas" do rodapé (a entrada "Revisão inteligente" do topo já cobre; o atalho vira link discreto ao lado da busca).
- **Treino:** resultado com 4 métricas (grid 2×2) + score 1×; CTAs: 1 primário "Praticar novamente" + secundários "Novo treino" e "Voltar às palavras" ("Somente erradas/difíceis" viram chips de pré-filtro dentro de "Novo treino"); "Como funciona" → 1 frase; reescrever modal de saída sem "auditáveis" → *"As respostas já enviadas ficam salvas; as pendentes não contam para hoje."*
- **Novas:** subtítulo da intro → *"A IA monta frases com o seu nível e corrige suas traduções na hora."*
- **Progresso:** nível mostrado 1× ("B1" grande em `--section-text` + "Intermediário" como section-title, sem repetir "(B1)"); seção "Sequência" sem pill de número (mantém os 7 dias).
- **Resumo:** pills de palavras do card de feedback saem (fica picker + "Já salvas"); CTAs colapsam para 1 primário + "Ver no calendário" outline.
- **Calendário (dia):** pill de duração total sai (duração fica por conversa).
- **Onboarding:** help repetido dos cards de objetivo sai (no máx. 1 linha na seção); "estilo de correção" usa as mesmas choice-cards do perfil.
- **Critério de aceite:** e2e atualizados e verdes (vários testes citam labels — atualizar junto); cada tela auditada contra a regra "streak/nível/duração/CTA ≤1".

### Fase 3 — Acabamento tela a tela (1–1,5 dia)

Checklist aplicado em ordem (espaçamentos via tokens, alinhamentos, detalhes locais):

1. **Home** — ritmo vertical uniforme (seções a 32, cards pad 20); divisores full-bleed padronizados; tiles com ícone ACIMA do número (anatomia única); PushOptInCard com ícone Bell no lugar do 🔔 e política em 1 linha.
2. **Chat** — bolhas 18/700 padding 18 raio 20; ações copy/traduzir em grupo de icon-buttons 36px; composer raio 24; status de voz em caption 12; espaçamento do goal-block.
3. **Palavras + treino + novas + detalhe** — `flashcard-entry` mantém o gradiente (assinatura) com raio 24/pad 20 e sombra já sectionada; busca e filtros com altura única 44 raio 16; rows com Pill compacto para "+N" e caption 12 no foot; steppers do treino 44×44; detalhe da palavra com pills → 1 pill de status ("Em prática") + caption "domínio 87/100" no meta.
4. **Calendário** — mês e dia com header padrão (`BackButton` + `ScreenHeader`); heatmap intocado; cards → `.card`; verdes hardcoded → tokens; dia com `MetricGrid` bordered.
5. **Progresso** — level-card com "B1" em `--section-text`; charts com caption única; foco da semana em `.card-soft`.
6. **Resumo** — header padrão; card de congratulação `.card-soft` com `MetricGrid` 4; picker com rows alinhadas.
7. **Perfil + conquistas + connections** — remover Tailwind morto; streak da meta vira `StreakPill` inline; ícones com cor de token; conquistas com `BackButton` (ChevronLeft); connections com header padrão e 1 único voltar (remover dark-button do rodapé), cards brancos `.card`.
8. **Onboarding + login** — ritmo do hero do login (gaps 28/4/22 → 12/6/24); wizard com CTA verde; celebração mantém.
- **Critério de aceite:** screenshot after de cada tela comparado lado a lado com o before; sem regressão de contraste; alvos ≥44px.

### Fase 4 — QA visual e release (meio dia)

1. Repetir o circuito de screenshots (servidor QA + fixture, viewport 390×844 — mesmos passos desta auditoria) → comparar before/after.
2. Passada de a11y: foco visível 3px `var(--section)` em todos os interativos, contraste dos textos sobre `--section-soft`, `prefers-reduced-motion` (já coberto).
3. `npm run lint && npm run typecheck && npm run test:unit && npm run build` + `test:e2e`.
4. **Bump do `CACHE_NAME` em `public/sw.js`** (obrigatório — PWA no celular senão fica na versão antiga).
5. Commit por fase; deploy no EasyPanel após Fase 4.

---

## Riscos e salvaguardas

| Risco | Salvaguarda |
|---|---|
| E2e quebram com mudança de copy/classes | Atualizar `tests/e2e/*.spec.ts` **na mesma fase** da mudança; rodar `test:e2e` a cada fase |
| `ButtonFeedback`/`PADRAO_INTERACAO.md` dependem de seletores de botão | Não renomear as classes `.outline-button/.dark-button/.green-button`; só padronizar **onde** cada uma é usada |
| Refactor de classes CSS quebra componentes irmãos | Mudança de classe sempre precedida de `grep` de uso; uma tela por commit |
| PWA servir versão antiga | Bump do `CACHE_NAME` no sw.js em todo deploy com mudança de UI |
| Regressão visual sem testes automatizados de UI | Circuitos de screenshot before/after por fase (procedimento desta auditoria) em `.playwright-mcp/audit/` |

## Esforço estimado

~4 a 5 dias-lote de trabalho: F0 0,5 · F1 1–1,5 · F2 1 · F3 1–1,5 · F4 0,5. F1 e F2 podem intercalar por tela (ex.: fazer Palavras inteira: base + corte + acabamento num único PR) se preferir entregar valor tela a tela em vez de camada a camada.
