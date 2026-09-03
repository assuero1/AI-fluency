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

### Tipografia (Nunito — pesos permitidos: 600 / 700 / 800 / 900)

| Papel | Classe/tamanho | Especificação |
|---|---|---|
| Display (título de tela) | `.title` | 31/900 |
| Título de seção | `.section-title` | 20/800 |
| Título de linha/card | `.row-title` | 18/800 |
| Corpo | — | 16/700 |
| Meta/label | `.row-meta` | 14/600 |
| Caption | — | 12/700 |
| Eyebrow | `.eyebrow` | 12/900 caps, tracking 0.08em |
| Métrica | `.metric-value` | clamp(24–28)/900 |
| Assinatura | `.word-big` | 52/900 |

### Ícones lucide — só estes tamanhos

16 (inline/pills) · 20 (rows/links/back) · 24 (ações/botões) · 28 (`IconBubble`, empty states) · 32 (hero/métrica grande)

### Cores

- Paleta por seção (`.section-*`): `--section`, `--section-deep`, `--section-soft`, `--section-text` — sempre via var, nunca hex.
- Semânticas: `--warning(-soft)`, `--info(-soft)`, `--danger(-deep/-soft)`, `--neutral(-deep/-soft)`.
- Complementares: `--streak` (#f59d1f, cor única da chama) · `--surface-muted` (#f8f5ee, bolha da IA).

## Semântica de botões

| Classe | Quando | Exemplo |
|---|---|---|
| `green-button` | Ação primária — iniciar/continuar prática, submit. **Máx. 1 por tela** | "Fazer minha prática" |
| `dark-button` | Confirmação neutra em modal | "Continuar mesmo assim" |
| `outline-button` | Ação secundária | "Ver no calendário" |
| `danger-button` | Ação destrutiva confirmada | "Apagar dados" |
| Ícone-ghost 44px | Sair/fechar sem peso destrutivo | X no header do chat |

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
