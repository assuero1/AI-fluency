# Talkito — Manual de Direção de Arte & Identidade Visual
> **Versão:** 2.0 (Design System *Sticker Calmo*)  
> **Papel:** Documento Oficial de Identidade da Marca, UI Art Direction & Design Tokens  
> **Status:** Ativo / Fonte Canônica para Designers, Desenvolvedores e IAs Gerativas

---

## 1. Manifesto da Marca & Visão Geral

### 1.1 O Que é o Talkito
O **Talkito** é uma plataforma móvel de aprendizado de idiomas voltada para **jovens adultos e profissionais**. Diferente dos apps tradicionais de repetição mecânica ou de ferramentas de IA frias e puramente utilitárias, o Talkito combina:
1. **Conversação fluida guiada por Inteligência Artificial** em cenários reais do dia a dia.
2. **Sensação tátil e acolhedora de gamificação** sem infantilizar o usuário.
3. **Design ergonômico e calmo**, que reduz a ansiedade de falar uma língua estrangeira e convida à prática diária consistente.

### 1.2 Personalidade da Marca (Brand Persona)
* **Acolhedora & Encorajadora:** Nunca repreensiva. Erros não geram punição ou perda de vidas; geram insights claros e mastigados em blocos amigáveis.
* **Adaptável & Empática:** Assim como seu mascote, o app molda-se ao nível, ritmo e objetivos do estudante.
* **Tátil & Lúdica (Chunky & Friendly):** Botões com relevo que dão prazer ao clique, cantos suavemente arredondados e superfícies que lembram adesivos em um caderno de anotações.
* **Serena & Não Tóxica:** Fundo em papel quente off-white, tipografia espaçada e ausência de elementos piscantes agressivos.

---

## 2. O Mascote: O Camaleão Talkito

### 2.1 Conceito e Simbolismo
O mascote oficial do Talkito é um **pequeno camaleão verde** em pé, de mãos na cintura e sorriso confiante.
* **Metáfora Linguística:** O camaleão é o mestre da adaptação. Aprender a falar um idioma significa adaptar-se a novos sons, culturas e contextos sociais.
* **Metáfora Cromática no App:** O camaleão muda de cor conforme o ambiente. No Talkito, a interface muda de cor conforme a seção (Verde na Home, Azul no Chat, Roxo nas Palavras, Laranja no Calendário e Âmbar no Progresso). O mascote reflete essa mesma transformação cromática nas telas de transição (`LoadingScene`).
* **Postura:** Postura de herói amigável, acessível, peito aberto, olhos grandes e curiosos. Ele não é um professor austero nem um juiz; é o parceiro de conversa do estudante.

### 2.2 Estilo de Ilustração & Anatomia Visual
* **Traço (Lineart):** Contornos nítidos e firmes em verde floresta escuro (`#1a4314`), com espessura constante e terminações suaves.
* **Cores do Mascote:**
  * Corpo Principal: Verde Lima Vibrante (`#7bd117` a `#58cc02`).
  * Barriga e Destaques: Verde Pastel Luminoso (`#a6eb34`).
  * Manchas na Cabeça: Verde Oliva Médio (`#4b8a13`).
  * Olhos: Pupilas pretas grandes com brilho especular duplo branco (expressividade viva e amigável).
  * Cauda: Espiral circular perfeita e harmoniosa.
* **Iluminação (Shading):** *Cell shading* limpo e estilizado, com ponto de luz sutil no topo do crânio e sombras suaves abaixo do queixo e dos braços. Sem texturas realistas ou gradientes complexos.

### 2.3 Diretrizes para Novas Poses & Gerações de Imagem (IA)
Ao solicitar ou gerar novos assets do mascote com IA:
```text
Prompt base para IA:
"Cute charismatic chameleon mascot, friendly green lizard cartoon character,
standing on two legs, hands on hips, big expressive curious eyes, round curly tail,
clean vector style, smooth lineart, modern edtech mascot, duolingo-inspired friendly aesthetic,
warm lighting, transparent or solid cream background #faf8f5, high quality, 2D cell-shaded."
```
* **Permitido:** Expressões de comemoração (com confetes), estudando com fones de ouvido, segurando uma xícara de café, pensando com balão de fala, trocando de cor conforme o módulo.
* **Proibido:** Traços agressivos, dentes pontiagudos, olhos esbugalhados realistas, texturas de réptil escamoso, excesso de render fotorrealista 3D.

---

## 3. Logotipia & Wordmark

### 3.1 Anatomia do Logo
* **Wordmark:** "Talkito"
* **Tipografia do Logotipo:** Sans-serif arredondada pesada (*Chunky Rounded Geometric*), com vértices e terminais 100% arredondados (similar a Nunito Black / Comfortaa Bold customizado).
* **Cor Institucional do Logo:** Verde Floresta Profundo (`#143823` / `rgb(20, 56, 35)`).
* **Por que Verde Escuro no Logo?** Enquanto a interface e o mascote usam o verde limão vibrante (`#58cc02`) para energia e toque, o wordmark utiliza o verde floresta profundo para trazer **ancoragem institucional, maturidade e contraste perfeito** sobre o fundo creme claro.

### 3.2 Regras de Aplicação
* **Zona de Proteção:** Respiro mínimo equivalente à altura da letra "o" em volta de todo o logotipo.
* **Redução Mínima:** Largura mínima de 80px em telas digitais.
* **Favicon / App Icon:**
  * O ícone quadrado do aplicativo (`icon-192.png`, `icon-512.png`, `icon-maskable`) utiliza a cabeça do camaleão em destaque frontal/três quartos sobre fundo creme `#faf8f5` ou verde profundo `#143823`.

---

## 4. Filosofia de Design UI: "Sticker Calmo"

O Talkito implementa a linguagem **"Sticker Calmo"** (*Calm Sticker*), que une o dinamismo físico dos jogos à serenidade de ferramentas modernas.

### 4.1 A Metáfora dos Três Níveis Táteis

```
┌─────────────────────────────────────────────────────────────┐
│  NÍVEL 2: STICKERS INTERATIVOS & BOTÕES 3D                  │
│  Botões com relevo inferior de 2px a 4px (translateY ativo) │
│  Ex: .green-button, .pill ativa, bolha do microfone         │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────┐
│  NÍVEL 1: CARTÕES E SUPERFÍCIES (Content Cards)             │
│  Fundo Branco Puro (#ffffff) + Borda Hairline (#efe9df)     │
│  Sombra Difusa Leve: 0 4px 12px rgba(31, 25, 16, 0.04)     │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────┐
│  NÍVEL 0: PAPEL DE FUNDO (Warm Paper Canvas)                │
│  Cor Creme Aconchegante: #faf8f5                            │
│  Conforto visual extremo, zero fadiga ocular                │
└─────────────────────────────────────────────────────────────┘
```

1. **Nível 0 — Papel Quente (`#faf8f5`):** O canvas do app não é branco hospitalar nem cinza frio; é um tom creme papel de caderno que acalma a vista.
2. **Nível 1 — Folhas e Cartões (`#ffffff`):** Os blocos de conteúdo repousam sobre o papel com bordas milimétricas suaves (`#efe9df` ou `#e8e2d8`) e sombra difusa quase imperceptível.
3. **Nível 2 — Adesivos Físicos (Botões e Chips):** Apenas os elementos clicáveis têm relevo tátil 3D (`--shadow-cta`), convidando a mão ao toque e dando retorno físico ao afundar no `:active`.

---

## 5. Paleta de Cores & Tokens Cromáticos

### 5.1 Cores Base de Superfície e Tipografia

| Token | Código HEX | Nome Visual | Aplicação Primária |
|---|---|---|---|
| `--bg` | `#faf8f5` | Papel Creme Quente | Fundo geral da aplicação e do `phone-shell` |
| `--surface` | `#ffffff` | Branco Puro | Cards, modais, inputs de texto |
| `--surface-2` | `#f5f1e9` | Areia Neutro | Blocos internos embutidos em cards |
| `--surface-muted`| `#f8f5ee` | Creme Suave | Bolhas de mensagem do tutor/IA |
| `--text` | `#1f1f1f` | Grafite Profundo | Texto corrido principal, títulos de tela |
| `--muted` | `#66625c` | Cinza Neutro Médio | Textos de apoio, subtítulos, metadados |
| `--subtle` | `#6f6a63` | Cinza Quente Sutil | Timestamps, placeholders, legendas |
| `--line` | `#e8e2d8` | Borda Neutra | Divisores e contorno estrutural padrão |
| `--line-soft` | `#efe9df` | Hairline Suave | Contorno de cartões no padrão *Sticker Calmo* |
| `--line-deep` | `#d9d0c2` | Sombra Neutra | Relevo 3D de botões outline neutros |

---

### 5.2 O Sistema Cromático Multisseção

Cada área funcional do app possui sua própria "assinatura cromática", com 4 papéis estritos:
* **Sólida (`--section`):** Ação primária, ícone ativo, destaque visual.
* **Deep (`--section-deep`):** Borda inferior 3D física, hover e estado pressionado.
* **Soft (`--section-soft`):** Fundo do card em destaque, bolha de diálogo, fundo de botão tonal.
* **Text (`--section-text`):** Tom escurecido calibrado para atingir contraste **WCAG AA** de leitura sobre superfícies claras.

#### Tabela de Seções e Tokens

| Seção do App | Sólida | Deep (Sombra 3D) | Soft (Pastel) | Text (Contraste AA) | Significado e Uso |
|---|---|---|---|---|---|
| **Marca / Início** | `#58cc02` | `#58a700` | `#e7f8d5` | `#417c00` | Começo da jornada, ação principal do dia, identidade Talkito. |
| **Chat & Diálogo** | `#1cb0f6` | `#148fd6` | `#ddf1fe` | `#0d649a` | Conversação em tempo real, voz, mensagens do aluno, escuta. |
| **Palavras (SRS)** | `#a560ff` | `#8549e8` | `#f1e6ff` | `#7443c9` | Treino de vocabulário, flashcards, memorização espaçada. |
| **Calendário** | `#ff9600` | `#d97c00` | `#ffeed6` | `#a35a00` | Rotina, histórico de práticas diárias, rituais e consistência. |
| **Progresso** | `#ffc800` | `#c79a00` | `#fff3c4` | `#8a6a00` | Nível CEFR (A1–C2), fluidez percentual, métricas e troféus. |
| **Neutro / Perfil** | `#52667a` | `#3f5062` | `#e9eef3` | `#3f5062` | Preferências, perfil, configurações e estados do sistema. |

---

### 5.3 Cores Semânticas de Feedback (Pedagogia Positiva)

| Token | Código HEX | Código Soft | Função Pedagógica |
|---|---|---|---|
| `--streak` | `#f59d1f` | — | Cor da chama de dias seguidos de estudo (consistência). |
| `--warning` | `#805900` | `#fff3cf` | Dicas construtivas da IA ("Por que isso importa?"). |
| `--info` | `#1f64b3` | `#e7f1ff` | Explicações gramaticais e informações de sistema. |
| `--danger` | `#ff4b4b` | `#ffe5e3` | Indicação de correção textual (sem tom punitivo) e mic ativo. |
| `--dark-cta` | `#111111` | — | Ação de contraste neutro em modais ou botões de sistema. |

---

## 6. Tipografia & Escala de Leitura

### 6.1 Família Tipográfica: Nunito
A tipografia oficial do Talkito é a **Nunito** (Google Fonts variable sans-serif).
* **Por que a Nunito?**
  * Possui terminais arredondados suaves que combinam naturalmente com o visual amigável do mascote e com as formas "chunky".
  * É extremamente legível em tamanhos reduzidos em telas de smartphone OLED e LCD.
  * Oferece amplitude de pesos desde o 500 (confortável para textos longos de chat) até o 900 (impacto tátil para botões e números).

### 6.2 Hierarquia e Escala de Pesos

| Papel | Classe CSS | Tamanho / Altura | Peso | Tracking |
|---|---|---|---|---|
| **Display Hero** | `.title` | `31px / 1.2` | 900 (Black) | `-0.02em` |
| **Título de Seção** | `.section-title` | `20px / 1.3` | 800 (ExtraBold) | `-0.01em` |
| **Título de Linha/Card** | `.row-title` | `17px / 1.35` | 700 (Bold) | `0` |
| **Corpo (Base)** | herdado (`body`) | `16px / 1.45` | **500 (Medium)** | `0` |
| **Legenda / Meta** | `.row-meta` | `14px / 1.4` | 500 (Medium) | `0` |
| **Eyebrow (Overline)** | `.eyebrow` | `12px / 1.2` | 900 (Black) | `+0.08em (Caps)` |
| **Botões Principais** | `*-button` | `17px / 1.2` | 800 (ExtraBold) | `-0.01em` |
| **Métrica / Contador** | `.metric-value` | `clamp(24px, 6vw, 28px)` | 900 (Black) | `-0.02em` |
| **Palavra Flashcard** | `.word-big` | `52px / 1.1` | 900 (Black) | `-0.02em` |

---

## 7. Geometria, Formas & Raios de Borda

No Talkito, a suavidade dos cantos é padronizada:

* `--radius-xs: 8px` ──> Tags, chips de correção, highlight de palavras
* `--radius-sm: 12px` ──> Mini botões de áudio, alertas compactos
* `--radius-md: 16px` ──> Botões principais (CTAs), inputs de texto, cards de seleção
* `--radius-lg: 24px` ──> Cards de conteúdo, painéis de tela, bolhas de chat do tutor
* `--radius-xl: 32px` ──> Face frontal dos Flashcards de vocabulário
* `--radius-pill: 999px` ──> Pills de status, badges, botões redondos de áudio e mic

---

## 8. Semântica de Botões & Elementos Interativos

### 1. Botão Primário (`.green-button` / CTA 3D)
* **Regra:** No máximo **1 por tela**.
* **Visual:** Fundo na cor da seção (`--section`), texto em alto contraste, relevo inferior 3D (`--shadow-cta: 0 2px 0 var(--section-deep)`).
* **Feedback de Toque:** Ao ser pressionado (`:active`), faz `translateY(2px)` e colapsa a sombra, simulando a sensação física de pressionar uma tecla.

### 2. Botão Secundário Tonal (`.outline-button` v2)
* **Regra:** Usado para ações de suporte ("Sugerir tema", "Ver calendário", "Repetir áudio").
* **Visual:** Fundo pastel suave (`--section-soft`), texto com cor de alto contraste (`--section-text`), sem borda e sem sombra 3D. Fica visualmente em segundo plano, deixando o CTA primário brilhar.

### 3. Botão Escuro Neutro (`.dark-button`)
* **Regra:** Ações confirmatórias neutras em diálogos ("Entendi", "Confirmar").
* **Visual:** Fundo `#111111` com relevo inferior de 2px em `#000000`.

### 4. Botão de Alerta / Destrutivo (`.danger-button`)
* **Regra:** Resetar histórico, excluir palavra, parar gravação.
* **Visual:** Fundo `--danger` (`#ff4b4b`) com relevo inferior em `--danger-deep` (`#d9372b`).

---

## 9. Iconografia & Grafismos Auxiliares

* **Biblioteca:** **Lucide Icons** com traço arredondado (*rounded caps/joins*).
* **Espessura do Traço:** 2px padronizado para manter a consistência com os botões e textos em Nunito.
* **Escala de Tamanhos:**
  * `16px`: Inline em tags, pills de streak (`Flame`), chips de status.
  * `20px`: Linhas de lista, botões de voltar (`ChevronLeft`), menus secundários.
  * `24px`: Ações principais de controle (Play/Pause de áudio, envio de mensagem, microfone).
  * `28px`: Ícones dentro de `IconBubble` e ilustrações compactas de cards.
  * `32px`: Hero badges, troféus e cards de métricas de grande destaque.

---

## 10. Motion, Transições & Micro-interações

### 10.1 Física do Toque
* **Duração de Toque (`--motion-press`):** `110ms`
* **Transição Base (`--motion-base`):** `240ms` com curva `cubic-bezier(0.23, 1, 0.32, 1)` (suave e natural).
* **Animações de Celebração (`--ease-spring`):** `420ms` com curva de mola `cubic-bezier(0.34, 1.4, 0.64, 1)` para quando o aluno atinge uma meta diária ou acerta um flashcard difícil.

### 10.2 Telas de Carregamento com o Mascote (`LoadingScene`)
O Talkito substitui loaders genéricos de círculos cinzas por micro-momentos narrativos do mascote:
* **Momento `enter`:** O camaleão se preparando ou acenando ao entrar em um módulo de treino.
* **Momento `think`:** O camaleão curioso olhando para cima com pontos animados enquanto a IA formula a resposta da conversa.
* **Momento `save`:** O camaleão comemorando com estrelas ou checklist ao persistir a sessão de treino.
* **Acessibilidade:** Se o usuário ativar `prefers-reduced-motion`, a animação em vídeo é automaticamente substituída pela ilustração estática do camaleão com `LoadingDots` suaves.

---

## 11. Guia para Geração de Imagens & Novos Assets com IA

Quando for gerar ilustrações, banners de onboarding, capas de temas de conversação ou novas poses do mascote, utilize as especificações abaixo:

### Paleta Obrigatória para Prompts de IA:
* **Backgrounds:** `#faf8f5` (Warm Cream Canvas) ou tons pastel suaves (`#e7f8d5`, `#ddf1fe`, `#f1e6ff`).
* **Verde Talkito Primário:** `#58cc02` com sombras em `#417c00`.
* **Estilo Visual:** Vetorial estilizado, formas geométricas amigáveis, cantos abaulados, iluminação plana com sombras de recorte (*flat cell shading*).
* **Composição:** Elementos limpos e espaçados no centro, sem poluição de detalhes realistas, grãos ou sujeiras fotográficas.

### Exemplos de Cenários para Geração:
1. **Tema "Viagem e Aeroporto":** Uma mala de viagem estilizada em azul pastel e verde com um passaporte e o camaleão Talkito conferindo a passagem com óculos de sol.
2. **Tema "Café da Manhã & Rotina":** Uma xícara de café com vapor ondulado em estilo cartoon e uma torrada com abacate em formato geométrico amigável.
3. **Tema "Trabalho Remoto & Reuniões":** Um notebook com tela aberta mostrando o gráfico de áudio ondulado verde e fones de ouvido estilizados repousando ao lado.

---

*Talkito Design Team — "Aprender idiomas com a confiança de quem muda de cor, mas nunca perde a identidade."*
