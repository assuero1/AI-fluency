# Padrão de UI — AI Fluency

Atualizado em 2026-09-03 (Fase 0 do plano de refinamento, ver `PLANO_REFINAMENTO_UI.md`). Este documento é a fonte de verdade dos tokens e regras de UI. Todo componente novo ou alterado deve obedecer a ele.

## Regras de ouro

1. **Nenhum valor visual solto em componentes.** Raio, espaçamento, cor, peso e tamanho de fonte/ícone vêm de token ou classe do `globals.css`. Nada de `style={{ marginTop/fontSize/gap }}` para layout (exceção: valores dinâmicos como largura de progresso).
2. **Sem hex em `*.tsx`.** Cores vêm das vars (`var(--section)`, `var(--line)` etc.). Única exceção documentada: SVGs ilustrativos (mascote).
3. **Um elemento = uma função, ≤1 por tela.** Streak, nível, duração, CTA primário: aparecem uma única vez por tela, sempre no mesmo lugar do app.
4. **Verbos idênticos para ações idênticas.** "Ver tudo" para links de lista; "Voltar a X" para back; "Praticar" para iniciar prática.
5. **Gradiente e 3D são a assinatura** (entrada do treino, faces do flashcard, troféus, botões chunky). O resto é plano e quieto.

## Tokens (`:root` do `globals.css`)

### Espaço (escala 4px)

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 · `--space-10` 40

Derivados: `--space-section: 32` (entre seções) · `--card-pad: 20` (padding interno de card)

### Raios — os únicos permitidos

| Token | Valor | Uso |
|---|---|---|
| `--radius-xs` | 8 | highlight de palavra, chips internos, micro-elementos |
| `--radius-sm` | 12 | botões compactos, sub-cards, alertas inline |
| `--radius-md` | 16 | botões chunky, inputs, steppers, choice-cards |
| `--radius-lg` | 24 | cards de tela, modais, bolhas de chat, composer |
| `--radius-xl` | 32 | só o hero: faces do flashcard / active-recall / resultado |
| `--radius-pill` | 999 | pills, avatares, botões redondos |

### Tipografia (Nunito variável — v2 "Sticker Calmo")

O **peso base do body é 500** (calmo); quem quiser destaque declara o peso. Display e eyebrow são
os únicos 900.

| Papel | Classe/tamanho | Especificação |
|---|---|---|
| Display (título de tela) | `.title` | 31/900 |
| Título de seção | `.section-title` | 20/800 |
| Título de linha/card | `.row-title` | 17/700 |
| Corpo | herdado do body | 16/500 |
| Meta/label | `.row-meta` | 14/500 |
| Pills (controle) | `.pill` | 16/600 |
| Caption | — | 12/500–700 |
| Botão | `*-button` | 17/800, tracking −0.01em |
| Eyebrow | `.eyebrow` | 12/900 caps, tracking 0.08em |
| Métrica | `.metric-value` | clamp(24–28)/900 |
| Assinatura | `.word-big` | 52/900 |

### Ícones lucide — só estes tamanhos

16 (inline/pills) · 20 (rows/links/back) · 24 (ações/botões) · 28 (`IconBubble`, empty states) · 32 (hero/métrica grande)

### Cores

- Paleta por seção (`.section-*`): `--section`, `--section-deep`, `--section-soft`, `--section-text` — sempre via var, nunca hex.
- Semânticas: `--warning(-soft)`, `--info(-soft)`, `--danger(-deep/-soft)`, `--neutral(-deep/-soft)`.
- Complementares: `--streak` (#f59d1f, cor única da chama) · `--surface-muted` (#f8f5ee, bolha da IA).

### Superfícies, elevação e motion (tokens v2)

- `--line-soft` (hairline leve) · `--surface-2` (superfície aninhada dentro de card).
- `--shadow-card` (elevação difusa dos cards) · `--shadow-cta` (chunk do botão primário — o único 3D da tela).
- Motion: `--motion-press` 110ms · `--motion-fast` 160ms · `--motion-base` 240ms · `--motion-spring` 420ms;
  curvas `--ease-out` (entradas), `--ease-inout` (movimento na tela), `--ease-spring` (celebração).
- **Regra de frequência**: navegação/teclado não animam; ação frequente ≤ 280ms; saída de modal
  sempre mais rápida que a entrada; celebração (raro) pode exagerar. Detalhes em
  `docs/PLANO_MODERNIZACAO_UI.md` §2.6.
- Higiene: `-webkit-tap-highlight-color: transparent` global; hover de transform só dentro de
  `@media (hover: hover) and (pointer: fine)`.

## Semântica de botões

| Classe | Quando | Visual v2 |
|---|---|---|
| `green-button` | Ação primária — iniciar/continuar prática, submit. **Máx. 1 por tela; único 3D da tela** (chunk 2px `--shadow-cta` + brilho no topo) | cor da seção |
| `outline-button` | Ação secundária — **tonal**: fundo `--section-soft`, texto `--section-text`, sem borda/sombra | tonal |
| `dark-button` | Confirmação neutra em modal | escuro + chunk 2px |
| `danger-button` | Ação destrutiva confirmada | vermelho + chunk 2px |
| Ícone-ghost 44px | Sair/fechar sem peso destrutivo | X no header do chat |
| `.text-button` | Ação terciária de baixo risco (Cancelar, Copiar) | texto `--section-text`, sem fundo |
| desabilitado | Estado inequívoco | `--neutral-soft` + `--subtle`, sem chunk |

Micro-interações (feedback de toque, som/vibração) seguem `docs/PADRAO_INTERACAO.md` — **não renomear** `.green-button/.dark-button/.outline-button/.danger-button`, o `ButtonFeedback` depende delas.

## Componentes padrão

| Componente | Uso |
|---|---|
| `ScreenHeader` | Header de toda tela (`title`, `subtitle?`, `streak?`, `centered?`). Streak só aqui (`StreakPill`) |
| `StreakPill` | Única renderização de streak do app |
| `BackButton` | Toda tela de detalhe: `ChevronLeft` + "Voltar a X", cor `--section-text` |
| `SectionHeader` | `section-title` + link "Ver tudo" opcional |
| `Card` (`.card` / `.card-soft` / `.card-flat`) | Anatomia única de card |
| `MetricGrid` | Grid de métricas (variante `bordered` para células com divisória) |
| `ModalDialog` | **Todo** modal (focus trap/acessibilidade) |
| `EmptyState` | Ícone 28 + título + meta + CTA opcional |
| `Pill` | Todo pill (nunca `<span className="pill">` cru) |

## Checklist de review (Definition of Done de tela)

- [ ] Sem hex/font-size/margin/gap inline em tsx (grep do §Regras)
- [ ] Raio, espaço, peso e ícone só da escala
- [ ] Streak, nível, duração e CTA primário aparecem ≤1×
- [ ] Mesma ação = mesmo verbo em todo o app
- [ ] Alvos de toque ≥44px; foco visível (3px `var(--section)`)
- [ ] Labels afetadas → e2e atualizados na mesma mudança
