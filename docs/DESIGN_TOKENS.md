# Design Tokens — AI Fluency

Fonte da verdade: `app/globals.css` (`:root` + blocos anexados ao fim). Este documento descreve o sistema; em caso de divergência, o CSS vence.

## Identidade

- Estilo: "chunky playful" — cartunesco e colorido estilo Duolingo, sem ser infantil (público adulto).
- Fonte: `Nunito` (variable, pesos usados 620–900), carregada via `next/font` em `app/layout.tsx` como `--font-nunito`.
- Fundo do app: off-white quente `--bg: #faf8f5`.
- Cor da marca (seção default): `--brand: #58cc02`.

## Superfícies e texto

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#faf8f5` | fundo do app e `.phone-shell` |
| `--surface` | `#ffffff` | cards e inputs |
| `--text` | `#1f1f1f` | texto principal |
| `--muted` / `--subtle` | `#66625c` / `#6f6a63` | texto secundário |
| `--line` | `#e8e2d8` | bordas (2px no estilo chunky) |
| `--line-deep` | `#d9d0c2` | sombra 3D de botões outline |
| `--border` | `var(--line)` | alias legado (não usar em código novo) |

## Paleta de seções (multi-cor por área)

Cada seção tem 4 tokens: sólida, `-deep` (sombra 3D e estados pressionados), `-soft` (fundo pastel) e o texto derivado.

| Seção | Sólida | Deep | Soft | Telas |
|---|---|---|---|---|
| Marca (`--brand*`) | `#58cc02` | `#58a700` | `#e7f8d5` | home, onboarding (default) |
| Chat (`--chat*`) | `#1cb0f6` | `#148fd6` | `#ddf1fe` | `/chat`, `/resumo` |
| Palavras (`--palavras*`) | `#a560ff` | `#8549e8` | `#f1e6ff` | `/palavras`, `/palavras/treino`, `/palavras/[wordId]` |
| Calendário (`--calendario*`) | `#ff9600` | `#d97c00` | `#ffeed6` | `/calendario`, `/calendario/[date]` |
| Progresso (`--progresso*`) | `#ffc800` | `#c79a00` | `#fff3c4` | `/progresso` |
| Neutro (`--neutral*`) | `#52667a` | `#3f5062` | `#e9eef3` | `/perfil`, `/settings/*`, erros, `/offline` |

Mecanismo: `AppShell` recebe `section` e aplica `.section-<valor>` no `.phone-shell`, que define `--section`, `--section-deep`, `--section-soft`, `--section-text`. Componentes consomem essas variáveis. Os aliases legados `--primary` / `--primary-soft` ficam **congelados no verde da marca** (custom properties resolvem `var()` no `:root` e herdam o valor computado), como `--border`: seletores antigos que os usam NÃO seguem a seção — consumidores em telas coloridas recebem overrides section-aware no fim do `globals.css`. Em código novo, use sempre `var(--section*)`, nunca `var(--primary)`. Textos/ícones sobre fundos claros usam `--section-text` (contraste).

Exceção de contraste: na seção progresso (amarela), `.green-button` usa texto `#4a3c00` em vez de branco.

## Semânticas

| Token | Valor | Uso |
|---|---|---|
| `--warning` / `--warning-soft` | `#805900` / `#fff3cf` | lembretes, streak |
| `--info` / `--info-soft` | `#1f64b3` / `#e7f1ff` | informações |
| `--danger` / `--danger-deep` / `--danger-soft` | `#ff4b4b` / `#d9372b` / `#ffe5e3` | correções, zona destrutiva, mic ouvindo |
| `--dark-cta` | `#111111` | botão escuro |

## Estilo chunky

- Botões (`.outline-button`, `.dark-button`, `.green-button`): borda 2px, raio 16px, `box-shadow: 0 4px 0 <tom deep>`; `:active` faz `translateY(4px)` e colapsa a sombra.
- Cards (`.choice-card`, `.settings-card`, `.topic-card`, `.soft-card`, `.progress-*-card`, `.calendar-feedback-card`): borda 2px `var(--line)`, `box-shadow: 0 3px 0 rgba(31,25,16,.05)`.
- Raios: `--radius-lg: 28px`, `--radius-md: 20px`; pills 999px.
- Layout: `--nav-height: 86px`, `--screen-pad: 24px`, shell `min(100%, 430px)`.

## Animações

Todas CSS puras e neutralizadas por `@media (prefers-reduced-motion: reduce)`:

| Keyframe | Uso |
|---|---|
| `dot-bounce` | `LoadingDots` (typing do chat, loading raiz) |
| `shimmer` | `Skeleton` dos loadings de rota |
| `wave-eq` | wave equalizador do `VoiceButton` durante reprodução |
| `pulse-halo` | halo do `.mic-button.listening` |
| `pop-in` | entrada das `.chat-row` |
| `bounce-in` | `.loading-mark` do loading de rota |
| `flame-pulse` | chama do streak (`.pill svg.lucide-flame`) |
| `spin` (legado) | spinners `Loader2` |

## Componentes de feedback

- `components/LoadingDots.tsx` — 3 pontos saltitantes com `role="status"` e `srText` para leitores de tela.
- `components/Skeleton.tsx` — variantes `line`/`card`/`circle`, `aria-hidden`.
- `app/loading.tsx` + `app/{palavras,progresso,calendario}/loading.tsx` — loading raiz animado e skeletons por rota.
