# Redesign "Chunky Playful" + Loadings Animados — Design

Data: 2026-07-31
Status: aprovado pelo usuário (2026-07-31)

## Contexto e objetivo

O AI Fluency é um app mobile-first (PWA, Next 15 + React 19) de aprendizado de inglês para adultos. A UI atual é branca/verde, minimalista e quase sem animações (apenas spin de ícone e flip 3D do flashcard). Este redesign deixa a UI **cartunesca e colorida — estilo "chunky" do Duolingo — sem ficar infantil**, e **corrige todos os estados de loading para que sejam animados**.

Decisões tomadas com o usuário:

- Direção visual: chunky estilo Duolingo (bordas grossas, botões 3D, animações saltitantes).
- Paleta: multi-cor por seção do app.
- Escopo: todas as telas numa tacada.
- Loadings: sistema completo de feedback animado.
- Stack: CSS puro + tokens, **zero dependências novas** (sem Tailwind, sem framer-motion).

## Estado atual (relevante)

- Estilo: `app/globals.css` único (~1950 linhas) com CSS variables + classes utilitárias próprias. Sem Tailwind, sem CSS modules. Ícones: `lucide-react`.
- Fonte: `Inter` declarada no CSS mas **nunca carregada** (cai em system-ui).
- Inconsistências de cor: verde primário existe em 3 valores (`#217a38` no CSS, `#2f9d4a` no doc e hardcoded inline em vários componentes). `var(--border)` é usada em 4 seletores mas nunca definida.
- Animações existentes: apenas `@keyframes spin`, transição da skip-link e flip 3D do flashcard. `prefers-reduced-motion` já é respeitado.
- Loadings atuais: spinners `Loader2` (ícone gira) mas **todo texto de espera é estático**; sem typing-dots no chat, sem skeletons, wave de áudio com alturas fixas (não animada), sem halo pulsante no microfone.

## 1. Sistema de tokens

Reescrita da fundação do `globals.css` (mantido como arquivo único, organizado em seções: tokens / base / animações / componentes / telas).

### Paleta multi-cor por seção

Cada seção tem 3 variantes: sólida (`--section`), `deep` (sombra 3D e estados pressionados) e `soft` (fundo pastel).

| Seção | Cor sólida | Uso |
|---|---|---|
| Marca / Home / Onboarding | verde `#58cc02` | botões primários, streak, identidade |
| Chat | azul `#1cb0f6` | header, bubbles de ação, pills, composer |
| Palavras + treino | lilás `#a560ff` | cards de flashcard, ratings, progresso |
| Calendário | laranja `#ff9600` | dias com feedback, cards de feedback |
| Progresso | amarelo `#ffc800` | card de nível, barras, foco |
| Perfil / Settings | neutro cinza-azulado | linhas de settings com acentos da marca |
| Correções / erros | vermelho `#ff4b4b` | blocos de correção, zona destrutiva |

Mecanismo: cada tela aplica uma classe no container (`.screen-chat`, `.screen-palavras`, etc.) que define `--section`, `--section-deep`, `--section-soft`. Componentes compartilhados (botões, pills, `IconBubble`, item ativo da `BottomNav`) consomem essas variáveis — a cor da seção se propaga automaticamente, sem prop drilling.

### Tokens chunky

- Botões: raio 16px, `box-shadow: 0 4px 0 var(--x-deep)`; ao pressionar (`:active`), `translateY(4px)` e sombra colapsa para `0 0 0`. Botões secundários: fundo branco, borda sólida 2px, sombra 3D na cor da borda.
- Cards: raio 24px, borda sólida 2px, sombra sólida sutil embaixo (ex: `0 3px 0 rgba(0,0,0,.06)`).
- Fundo do app: off-white quente `#faf8f5` (substitui branco puro; alinha com o mockup `ai-language-learning-static-design.html`).
- Raios, espaçamentos e `--nav-height`/`--screen-pad` existentes são mantidos.

### Fonte

`Nunito` (pesos 700/800/900) via `next/font/google` no `app/layout.tsx`, exposta como CSS variable e aplicada a títulos e corpo, com fallback `system-ui, sans-serif`. Auto-hospedada pelo Next (sem request externo em runtime, compatível com PWA/offline).

### Correções de base (parte do redesign)

- Verde único: substituir `#217a38`, `#2f9d4a` e os valores hardcoded inline pelos tokens da marca.
- Definir `--border` (usada e indefinida em: selection-explainer, vocabulary-option, flashcard-attempt/reveal, recall-rating-grid).
- Migrar cores hardcoded inline nos componentes (`HomeDashboard.tsx`, `ChatConversation.tsx`, blocos de flashcard) para tokens.
- Atualizar `docs/DESIGN_TOKENS.md` ao final da implementação.

## 2. Sistema de loadings animados

Componentes novos em `components/` (flat, seguindo o padrão do projeto), animação 100% CSS:

- `LoadingDots.tsx` — 3 pontinhos pulando em stagger. Props: tamanho/cor via CSS (consome `--section`). Usado em textos de espera e dentro da `TypingBubble`.
- `TypingBubble.tsx` — bubble da IA com `LoadingDots` (substitui o texto estático "A IA está preparando a próxima resposta..." em `ChatConversation.tsx:552-553`).
- `Skeleton.tsx` — bloco com shimmer (gradiente animado), variantes linha/card/círculo. Usado nos `loading.tsx` por rota.
- Wave de áudio animada — as barras `.wave` (hoje alturas fixas em `globals.css:1139-1156`) viram equalizador animado (keyframes de altura em stagger) nos estados gravando/reproduzindo de `VoiceButton.tsx`.
- Halo pulsante no mic-button durante "Ouvindo..." (`ChatConversation.tsx:623`).
- `app/loading.tsx` — mark com bounce elástico + `LoadingDots` no texto.
- `loading.tsx` por rota principal (`palavras`, `progresso`, `calendario`) com `Skeleton` espelhando o layout da tela — hoje só existe o loading raiz.
- Botões em loading: mantêm `Loader2` girando + transição de estado (label + `disabled` visual/ARIA). Sem mudança de lógica.

Keyframes novos (todos com fallback em `prefers-reduced-motion`): `dot-bounce`, `shimmer`, `wave-eq`, `pulse-halo`, `pop-in`, `bounce-in`.

## 3. Micro-interações chunky

- Press de botão: `translateY` + colapso da sombra 3D.
- Hover em cards de escolha/listas: eleva 2px.
- Mensagens do chat entram com `pop-in` elástico.
- Chama do streak com pulso sutil.
- Flip 3D do flashcard: mantido, apenas easing ajustado para spring (`cubic-bezier`).

## 4. Telas

Todas as rotas recebem a cor da sua seção (header, CTAs, bubbles, pills, item ativo da `BottomNav`):

- `/` home — verde marca
- `/chat` — azul
- `/palavras` e `/palavras/treino` — lilás
- `/calendario` e `/calendario/[date]` — laranja
- `/progresso` — amarelo
- `/perfil` e `/settings/*` — neutro com acentos da marca
- `/resumo` — azul (é o resumo de encerramento da conversa do chat)
- `/onboarding` — verde marca
- Erros (`error.tsx`, `not-found.tsx`, `/offline`) — neutro + acento da marca

Estrutura, conteúdo e lógica das telas **não mudam** — apenas classes/tokens aplicados e, onde listado acima, markup novo para os componentes de loading.

## 5. Erros e edge cases

- Estados de erro existentes (blocos `app-error`, botões de retry) recebem apenas os novos tokens — comportamento e fluxo intactos.
- `prefers-reduced-motion`: todas as animações novas são desligadas/reduzidas nesse modo (padrão já existente no CSS).
- Falha de fonte: fallback de sistema mantém o app usável.
- Loadings em botões mantêm `disabled` durante a ação (sem duplo-submit — comportamento já existente, preservado).

## 6. Testes e verificação

- Testes unit/e2e existentes devem continuar verdes (mudança é 100% apresentacional).
- Smoke tests de render para `LoadingDots` e `Skeleton` se houver infra de teste de componente (verificar `tests/unit` na implementação); caso contrário, cobertura via e2e existente + QA visual.
- QA visual com screenshots das telas principais ao final (dev server + Playwright já presentes no projeto).

## Fora de escopo

- Mascote/personagem ilustrado (o usuário optou pelo sistema de feedback sem mascote).
- Mudanças de lógica, dados, rotas de API ou backend.
- Migração para Tailwind ou adoção de biblioteca de animação.
