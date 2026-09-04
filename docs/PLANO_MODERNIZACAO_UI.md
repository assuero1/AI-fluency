# Plano de Modernização UI — "Sticker Calmo"

Criado em 2026-09-03, derivado da avaliação em `docs/AVALIACAO_UI_UX_2026-09-03.md`.
Direção: **mais moderno, clean e minimalista, com personalidade, mantendo a paleta** e fiel ao logo
(camaleão Talkkito). Sucessor do plano F0–F4 (fases aqui usam a letra **M**).
**v1.1 (2026-09-03):** revisão com lente de design engineering — §2.6 reescrito com tabela de
frequência de motion, correções pontuais de código (flip 500ms, press, progresso via scaleX),
§2.7 novo (perceived performance), aceite de M0/M2/M4/M5 expandido.

---

## 1. Direção de design

### O que o logo nos ensina (vocabulário de marca)

Analisando o mascote e suas variantes (`logo/`):

| Traço do logo | Tradução para a UI |
|---|---|
| **Poucos traços grossos e confiantes** (desenho minimalista com contorno escuro fino) | Menos elementos por tela; superfícies calmas; o contorno só aparece onde a marca "assina" |
| **Dois tons de verde + acento por fantasia** (mago roxo = seção palavras) | Paleta por seção mantida e reforçada; mascote fantasiado como sistema, não enfeite |
| **Espiral da cauda** | Novo motivo de marca: spinner, progresso de conquista, decor de hero (máx. 1× por tela) |
| **Balão de fala** ("Olá de novo!") | Componente `Bubble` padronizado para dicas/contexto |
| **Sombra elíptica suave sob os pés** | Elevação difusa e baixa nos cards (substitui borda grossa + sombra dura) |
| **Olho grande e círculos** | Escala de raios generosa atual se mantém |

### Conceito: "Sticker Calmo"

> **Superfícies silenciosas, momentos de marca altos.** O fundo e os cards sussurram (peso de fonte
> leve, hairlines, elevação difusa); quando a marca aparece — CTA primário, mascote, espiral,
> celebração — ela aparece com a confiança do desenho do logo.

**O problema central hoje não é cor nem layout — é peso.** A distribuição atual de font-weight é
700 (27×), 800 (21×), 600 (11×), 900 (7×): **nada no app é leve**. Tudo grita, então nada destaca.
Cards com `border: 2px` + sombra dura `0 3px 0` competem com os botões 3D. Remover esse ruído é o
que torna "clean" sem tocar na paleta.

### O que NÃO muda (compromissos)

1. **Paleta**: todos os tokens de cor (`--brand`, `--chat`, `--palavras`, `--calendario`,
   `--progresso`, semânticas) ficam intocados. A paleta por seção via `.section-*` permanece.
2. **Escala de raios** (`--radius-xs…xl`) e escala de espaço 4px: mantidas.
3. **Nunito**: é a voz da marca (redonda como o mascote). Não trocamos a fonte — reequilibramos pesos.
4. **CTA primário chunky** (borda inferior escura): é a assinatura "sticker" do app e está no DNA do
   logo cartoon. Fica, porém **exclusivo do botão primário** — nenhum outro elemento 3D concorre.
5. **Um primário por seção** (verde home / roxo palavras / azul chat): mantido.
6. **Mascote**: só em empty states, loading e celebração. Nunca em card de conteúdo.

### Risco estético assumido

Abrandar os cards pode "achatar" o charme cartoon. Mitigação: o chunk 3D **concentra-se no CTA
primário** (única peça 3D por tela em viewport), e a espiral + `Bubble` carregam o cartoon onde o 3D
sai. Personalidade migra de "tudo em relevo" para "relevo com assinatura".

---

## 2. Sistema visual v2 (deltas exatos)

### 2.1 Tipografia — reequilíbrio de pesos (maior ganho de clean)

| Papel | Hoje | V2 | Nota |
|---|---|---|---|
| Display (`.title`, `.word-big`, `.metric-value`) | 900 | **900** (mantém) | O grito fica só aqui |
| Título de seção (`.section-title`) | 20/800 | **20/800** (mantém) | |
| Título de linha/card (`.row-title`) | 18/800 | **17/700** | desce 1 tom |
| **Corpo** | 16/**700** | 16/**500** | a mudança mais visível do plano |
| Meta/label (`.row-meta`) | 14/600 | 14/**500** | |
| Caption | 12/700 | 12/**500** | |
| Botão | 18/700 | 17/**800**, tracking −0.01em | mais denso, menos "grito" |
| Eyebrow | 12/900 caps | mantém | assinatura existente |

Atualizar a tabela de pesos no `docs/PADRAO_UI.md` (hoje permite só 600–900).

### 2.2 Superfícies e elevação

```css
/* Novos tokens */
--line-soft: #efe9df;            /* hairline v2 */
--surface-2: #f5f1e9;            /* superfície aninhada (dentro de card) */
--shadow-card: 0 1px 2px rgba(31,25,16,.04), 0 10px 28px rgba(31,25,16,.06);
--shadow-cta: 0 2px 0 var(--section-deep);   /* chunk v2: de 3–4px para 2px */

/* Motion — a FREQUÊNCIA de uso define a duração (regra §2.6) */
--motion-press: 110ms;           /* feedback de toque; nunca mais que isso */
--motion-fast: 160ms;            /* hover, pills, saídas de modal */
--motion-base: 240ms;            /* entradas ocasionais (modal, sheet, flip) */
--motion-spring: 420ms;          /* celebração — momento raro, pode ser longo */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* entradas: começam rápido */
--ease-inout: cubic-bezier(0.77, 0, 0.175, 1);   /* movimento na própria tela (flip) */
--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1); /* pop de celebração */
```

- `.card`: de `border: 2px solid --line; box-shadow: 0 3px 0 …` →
  `border: 1px solid --line-soft; box-shadow: var(--shadow-card);` `--card-pad: 20 → 24`.
- `.card-soft` (tintura da seção): mantém, sem sombra, hairline só se houver conteúdo interativo.
- **Regra v2 de bordas**: uma tela no máx. 2 níveis de contorno (screen → card). Conteúdo dentro de
  card usa `--surface-2` ou hairline, nunca ambos.
- Bottom nav: mantém blur + hairline (já moderno); item ativo ganha fundo `--section-soft` em pílula
  (hoje é só cor de ícone/texto) — reforça seção sem adicionar ruído.

### 2.3 Botões v2

| Classe | Hoje | V2 |
|---|---|---|
| Primário (`green-button` etc.) | border 1px + sombra 3–4px + bg chapado | **sem borda**; `box-shadow: var(--shadow-cta)`; leve `inset` de luz no topo (`inset 0 1px 0 rgba(255,255,255,.25)`); 56px mantém |
| Secundário (`outline-button`) | border 1px + sombra dura | **tonal**: bg `--section-soft`, texto `--section-text`, sem borda, sem sombra (hover: bg -deep 8%) |
| Terciário/ghost | — | novo: texto `--section-text`, sem fundo; para ações de baixo risco (Copiar, Traduzir) |
| `danger-button` | mantém com chunk 2px | idem primário |
| Disabled | versão pálida da cor | **bg `--neutral-soft`, texto `--subtle`** — inequívoco |

`ButtonFeedback` (PADRAO_INTERACAO) continua dependendo dos nomes de classe — não renomear.

### 2.4 Redução de elementos (minimalismo = subtrair)

- **Máx. 2 pills por card** (word-detail hoje tem 5 entre tags/estados). Estado vira texto-meta.
- **Máx. 1 linha de meta secundária por card**; cortar linhas "todos zero" (palavras, progresso).
- Links de seção: só "Ver tudo →"; estado vazio NUNCA renderiza como link (bug da home).
- Home: "Sugerir um tema para mim" → "Sugerir um tema" (1 linha); sugestões com clamp de 2 linhas.
- Progresso: hero diz o próximo nível UMA vez (cortar a linha duplicada).

### 2.5 Motivos de marca (a personalidade onde o 3D saiu)

1. **`SpiralSpinner`**: SVG da espiral da cauda traçando (stroke-dashoffset) — substitui os dots de
   loading; também marca progresso parcial nas Conquistas.
2. **`Bubble`**: balão do mascote (raio assimétrico + rabinho CSS) para dicas/contexto — substitui
   cards de dica genéricos ("Use 'practice' numa conversa", banner "Ajustamos algumas atividades…").
3. **Mascote por seção**: mapear variantes do `logo/` (verde=home, roxo=palavras, …; gerar as que
   faltam no mesmo estilo via `generate-brand-assets.mjs`). Presente só em EmptyState v2 (ícone →
   mascote 64px opcional), LoadingScene e celebração de sessão.

### 2.6 Motion com propósito (revisão design-engineering v1.1)

**Regra mestre — a frequência decide se anima e quão rápido:**

| Frequência de uso | Elementos no app | Decisão |
|---|---|---|
| Dezenas+/dia (troca de tela, navegação, digitar) | bottom nav, rotas, composer | **Nada de animação.** Conteúdo aparece instantâneo |
| Dezenas/semana (flip de card, avaliar card, enviar msg) | flashcard, grade, chat | ≤ 280ms, feedback imediato, sempre interruptível |
| Ocasional (modais, sheets, diálogos) | setup de prática, confirmações | 200–280ms entrada, **160ms saída** (saída sempre mais rápida) |
| Raro (celebração, onboarding, conquista desbloqueada) | fim de sessão, troféu | Pode ter spring e momento longo (até 500ms) |

**Correções específicas do código atual:**

| Before | After | Why |
| --- | --- | --- |
| `transition: transform .5s` no flip do flashcard (globals.css:2603) | `280ms var(--ease-inout)` | É a animação mais repetida do app; 500ms acumula fadiga e faz o treino parecer lento |
| Sem transform de press nos botões (só som/vibração) | `:active { transform: translateY(2px); box-shadow: none; }` a 110ms | O colapso do chunk é o feedback visual que confirma o toque; som sem transform parece "solto" |
| Barras de progresso animando `width` | `transform: scaleX()` com `transform-origin: left` | `width` dispara layout a cada frame; scaleX roda na GPU |
| Modais saem na mesma velocidade que entram | entrada 240ms ease-out, saída 160ms ease-out | O usuário já decidiu sair; a saída lenta bloqueia o próximo gesto |
| Stagger de lista sem limite | stagger 40ms só nos 6 primeiros itens, nunca bloqueia interação | 15 Conquistas em cascata = 600ms de espera perceptível |
| LoadingScene em toda rota, imediato | delay de 250ms antes de mostrar; loads rápidos não "piscam" cena | Spinner em load de <250ms parece mais lento que nenhuma animação |
| `prefers-reduced-motion` genérico | manter transições de opacity/cor; remover todo movimento de transform | Reduced motion = mais suave, não zero; opacidade ajuda compreensão |

**O que NÃO anima (lista explícita):** troca de aba da bottom nav, navegação entre rotas, teclado
(esconder/mostrar composer segue o sistema), mudança de valor de pill/checkbox (cor troca seca,
120ms), atualização de contador após ação.

**Onde a personalidade se permite (raro → pode encantar):** celebração de sessão (spring no mascote,
espiral desenhando com stroke-dashoffset), desbloqueio de conquista (pop 0.95→1 com `--ease-spring`),
e o número "0 de 15 min" contando até o valor na primeira carga do dia (400ms, uma vez por dia).

**Higiene base (M0):** `-webkit-tap-highlight-color: transparent` (o flash cinza do Android briga
com o nosso `:active`), `-webkit-font-smoothing: antialiased`, hover gating com
`@media (hover: hover) and (pointer: fine)` (o PWA roda em desktop), e popover/tooltip com
`transform-origin` ancorado no gatilho (painel do tutor, dicas) — modais permanecem centrados.

### 2.7 Perceived performance

- **UI otimista no treino**: avaliar card atualiza fila/contador na hora; sincronização acontece em
  background — o card seguinte nunca espera o POST.
- **Chat otimista**: mensagem do usuário entra na thread imediatamente (bolha com opacity 0.7 até
  confirmar); indicador "pensando" com dots rápidos (período de 900ms, não 1.6s — spinner rápido
  faz o carregamento parecer mais rápido com o mesmo tempo real).
- **Timer do chat** pausa em `visibilitychange` (app em background não pode cobrar minutos) — edge
  case invisível que protege a confiança na métrica.
- **Overlay "Montando seu treino…"**: ganha botão Cancelar após 4s + spinner rápido; nunca um
  bloqueio sem saída.
- **Métricas não piscam**: primeira carga mostra os valores direto; só re-render de dado assíncrono
  usa transição de opacity 160ms.

---

## 3. Fases de execução

### M0 — Fundações v2 (tokens + docs) · ~½ dia
- [ ] Adicionar tokens novos (`--line-soft`, `--surface-2`, `--shadow-card`, `--shadow-cta`, motion)
      em `app/globals.css:root`.
- [ ] Ajustar pesos conforme §2.1 (trocas pontuais em `.card`, `.row-title`, `.row-meta`, body,
      botões, caption). Zero custo de rede: a Nunito já entra como **fonte variável** via
      `next/font` (`app/layout.tsx:7`) — os pesos novos vêm no mesmo arquivo.
- [ ] Higiene base do §2.6: `-webkit-tap-highlight-color: transparent`,
      `-webkit-font-smoothing: antialiased`, gating de hover, tokens de motion (§2.2).
- [ ] `docs/PADRAO_UI.md` → v2: tabela de pesos, regra de bordas/elevação, botão tonal/ghost, regra
      de pills, motivos (espiral/bubble/mascote), tabela de frequência de motion (§2.6).
- [ ] Bump do `CACHE_NAME` no `public/sw.js` (regra [[pwa-sw-cache-bump]]).
- **Aceite**: app inteiro já perceptivelmente mais leve com ZERO mudança de componente; greps da DoD
  passam; `grep "transition: all"` = 0; contraste AA mantido (pesos menores exigem re-checar
  `--muted`/`--subtle` sobre `--bg` — se falhar, escurecer token, não subir peso).

### M1 — Componentes base v2 · ~1 dia
- [ ] `Button` v2 (primário sem borda + chunk 2px + inset de luz; tonal; ghost; disabled neutro).
- [ ] `Card` v2 (hairline + sombra difusa; variante `card-flat` sem sombra para aninhado).
- [ ] `Pill` v2 (sem borda; sólido-soft apenas); `EmptyState` v2 (slot de mascote; CTA tonal).
- [ ] Novos `SpiralSpinner` e `Bubble` (componentes + estilos, zero hex inline).
- [ ] `ModalDialog` v2 (raio-lg, sombra difusa, sem borda dupla).
- [ ] Nav: pílula ativa `--section-soft`.
- **Aceite**: login, home, treino e chat capturados com o novo look sem mudar nenhuma página; alvos
  ≥44px; foco visível 3px mantido.

### M2 — Telas núcleo · ~1,5 dia
- [ ] **Home**: clamps e cortes do §2.4; seção "Hoje" herda card v2; feedback links corrigidos.
- [ ] **Chat**: "Finalizar conversa" → ghost/tonal compacto no header de sessão (sai de cima do
      composer); botão-flutuante do tutor → item na toolbar; `Bubble` no tópico (mata o truncamento
      "TÓPICO Re…"); seletor de idioma da home mostra nome completo (encolhe o chip de nível);
      envio otimista da mensagem (bolha entra na hora, opacity 0.7 até confirmar);
      `visibilitychange` pausa o timer da sessão.
- [ ] **Treino**: faces do flashcard mantêm raio-xl + gradiente (assinatura), interior mais leve
      (pesos v2, meta única); corrigir "Português → idioma estudado" → idioma real do perfil;
      fila vazia usa `EmptyState` v2 com mascote; stepper "Novas por dia" com default sugerido 3
      (decisão de produto a confirmar).
- [ ] **Motion do treino/chat (§2.6)**: flip de 500ms → `280ms var(--ease-inout)`
      (globals.css:2603); press com colapso de chunk (translateY 2px, 110ms); grade do verso sobe
      200ms ease-out; barras de progresso via `scaleX`; UI otimista ao avaliar card; overlay de
      montagem com Cancelar após 4s.
- [ ] **Palavras + word-detail**: pills ≤2; stats sem "lapsos" (copy: "esquecimentos recentes");
      CTA "Praticar palavras fracas" volta ao primário da seção (roxo).
- **Aceite**: circuito de screenshots M2 compara antes/depois; nenhum texto essencial truncado em
  390px; 1 primário por viewport.

### M3 — Telas secundárias · ~1,5 dia
- [ ] **Conquistas (redesign)**: back no topo (`BackButton`); cada conquista com anel-espiral de
      progresso (x/50) e a "mais próxima" destacada em card-soft da seção; copy sem "Duolingo".
- [ ] **Progresso**: dessaturar (hero amarelo mantém, cards de conteúdo viram branco com acentos
      âmbar); semana D S T Q Q S S (mesma do calendário); pluralização correta nas métricas.
- [ ] **Perfil**: selected-state das pills/choice-cards **verde** (unifica com onboarding);
      "Idioma ativo" sem truncar (duas linhas se preciso).
- [ ] **Onboarding**: input "Seu nome" com hairline + fundo `--surface-2` (hoje parece heading).
- [ ] **Calendário**: legenda com pontos visíveis (usa `--section-soft → --section` gradient real);
      "1 feedback(s)" corrigido (M4 helper).
- [ ] **Connections**: esconder da navegação do perfil (rota fica, link protegido por
      `?debug=1`/env) — decide com usuário se entra nesta fase ou à parte.
- **Aceite**: Conquistas tem progresso visível e back; nenhum selected-state fora do padrão verde.

### M4 — Estados & copy · ~1 dia
- [ ] Helper `plura(n, singular, plural)` em `lib/` + varredura dos "(s)"
      (`calendario/page.tsx:38`, `ProgressoDashboard`, `VocabularyPicker.tsx:99-129`).
- [ ] Estados vazios/zero: mascote + 1 frase + 1 CTA; remover linhas "todos zero".
- [ ] Offline/error v2: ícone neutro (não verde), CTA primário da seção, mascote opcional.
- [ ] A11y pass: `prefers-reduced-motion` conforme §2.6 (manter opacity/cor, remover transform);
      contraste AA de todos os novos tokens; labels de pill em `aria-label` quando abreviadas.
- [ ] LoadingScene com delay de 250ms (§2.7): loads rápidos não piscam cena; cenas completas só em
      operações sabidamente longas (IA, montagem de sessão).
- **Aceite**: grep "(s)" zerado em strings de UI; lighthouse/a11y sem regressão.

### M5 — QA visual & entrega · ~½ dia
- [ ] Rodar circuito completo (`visual-audit-after/extra/flows`) + comparação antes/depois por tela.
- [ ] **Review de motion em câmera lenta**: flip, grade, modais e celebração a 0.25× no DevTools —
      procurar estados sobrepostos, easing que "morre" no fim, transform-origin errado.
- [ ] **Teste em aparelho real** (PWA instalado): press, swipe, teclado, vibração e velocidade
      percebida do treino; devtools remotos via USB.
- [ ] Checklist DoD do PADRAO_UI v2 tela a tela; screenshots no celular real (PWA).
- [ ] Bump final do sw, PR único ou por fase (recomendo: um PR por fase M, facilitando rollback).

**Total estimado: ~5–6 dias de execução.** Ordem importa: M0 isolado já entrega 60% da sensação
"clean"; se algo precisar ser cortado, M3 (redesign de Conquistas) é a peça mais carregada.

---

## 5. Execução (2026-09-03/04) — ✅ CONCLUÍDA

| Fase | Commit | Status |
|---|---|---|
| M0 Fundações | `a1d35a5` | ✅ tokens v2, peso base 500, higiene de toque, PADRAO_UI v2, sw v25 |
| M1 Componentes | `0acfa5a` | ✅ botão tonal/chunk 2px, cards hairline+difusa, pills tonais, nav pílula, SpiralSpinner, Bubble, EmptyState c/ mascote |
| M2 Núcleo | `3706f87` | ✅ flip 280ms, idioma real no card, fila vazia com mascote, overlay cancelável, chat (Bubble no tópico, professor na toolbar, Finalizar tonal), home (idioma completo, clamps, pés calmos), progresso scaleX |
| M3 Secundárias | `1c047e5` | ✅ Conquistas (back no topo, anéis, próxima destacada), selecionado=verde global, progresso dessaturado + semana-calendário, field-input visível, legenda; **corrige bug latente (TDZ) que impedia desbloqueio de conquistas em palavras novas** |
| M4 Estados & copy | `4e44f52` + bump sw v26 | ✅ helper `plura` (fim do "(s)"), zeros ocultos, offline neutro, cena de rota com delay 250ms, reduced-motion, pills ≤2 |
| Ajustes de QA | `90fef25` + finais | ✅ colisão `.bubble`→`.brand-bubble`, plurais remanescentes, flows de QA com retomada |
| M5 QA visual | este relatório | ✅ 21 telas/estados recapturados em `.playwright-mcp/m5-final/`; greps de aceite: `transition: all`=0, "(s)"=0, hex em tsx=1 (justificável), 656/656 testes |

**Pendências conscientes (não bloqueiam):**
- `/settings/connections` segue navegável (decisão de flag ficou para o usuário).
- Review de motion em câmera lenta + teste em aparelho real → usuário (M5 do plano).
- "Novas por dia" continua default 0 (decisão de produto).

---

## 4. Autocrítica do plano (antes de construir)

- Será que ficou genérico? O teste: hairline + peso leve é resposta comum para "clean", mas o
  conjunto **chunk-concentrado-no-CTA + espiral + Bubble + mascote fantasiado por seção** só existe
  nesta marca. A espiral é o risco assinatura — se ficar decorativa demais, corta-se sem afetar o
  resto (é um componente isolado).
- Perda do charme 3D? O chunk continua em TODOS os botões primários — o que sai é o 3D dos cards,
  que hoje briga com o botão. Quem assina o estilo passa a ser 1 objeto por tela, como no logo
  (1 mascote, 1 espesso contorno).
- Peso 500 no corpo pode ficar fraco no cream bg? Verificação de contraste em M0 com fallback
  definido (escurecer `--muted`, não voltar o peso).
- **v1.1:** a primeira versão animava entrada de página (fade+rise 240ms) — violava a própria regra
  de frequência (rotas são tocadas dezenas de vezes por dia). Corrigido no §2.6: navegação não
  anima; stagger fica restrito a listas de dados ocasionais. Outro auto-erro: assumi custo de rede
  ao adicionar pesos 400/500 — a Nunito já é variável via next/font (`app/layout.tsx:7`), custo zero.
