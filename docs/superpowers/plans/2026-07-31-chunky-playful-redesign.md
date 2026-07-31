# Redesign "Chunky Playful" + Loadings Animados — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a UI do AI Fluency cartunesca e colorida (chunky estilo Duolingo, multi-cor por seção, sem ficar infantil) e tornar todos os estados de loading animados.

**Architecture:** CSS puro sem dependências novas. O `app/globals.css` ganha um `:root` reescrito com paleta multi-cor por seção (`--section`/`--section-deep`/`--section-soft`/`--section-text`, propagada via classe `.section-*` no `.phone-shell` pelo `AppShell`), aliases `--primary: var(--section)` para que os seletores existentes herdem a cor da seção automaticamente, e uma "camada chunky" de overrides anexada ao fim do arquivo (botões 3D, cards, animações, recolors). Três componentes novos (`LoadingDots`, `Skeleton`, `TypingBubble` via `LoadingDots`), `loading.tsx` por rota, e fonte Nunito via `next/font`.

**Tech Stack:** Next 15 + React 19, CSS custom properties, lucide-react, vitest (testes de contrato por leitura de arquivo, idiom já usado em `tests/unit/accessibility-contracts.test.ts`).

**Spec:** `docs/superpowers/specs/2026-07-31-chunky-playful-redesign-design.md`

## Global Constraints

- **Zero dependências novas** de runtime (sem Tailwind, sem framer-motion). Animação 100% CSS.
- Mudança **100% apresentacional**: proibido alterar lógica, dados, rotas de API ou props de comportamento.
- `app/globals.css` continua arquivo único. Novas regras entram **anexadas ao fim do arquivo** (cascata vence por ordem), exceto a reescrita do `:root` (in-place) e as media queries existentes (intocadas).
- O bloco `@media (prefers-reduced-motion: reduce)` existente (`globals.css:1810-1819`) usa `!important` em `animation-duration`/`transition-duration` — já neutraliza qualquer animação nova. Manter intacto.
- Textos em pt-BR. Comentários de código em pt-BR ou inglês neutro, seguindo o arquivo.
- Testes no idiom do projeto: `fs.readFileSync` + `toContain` com vitest. Arquivo de contrato único `tests/unit/ui-redesign-contracts.test.ts`, estendido a cada tarefa.
- **Git:** a política do ambiente exige pedir confirmação do usuário antes de mutações git. Antes do primeiro commit, perguntar ao usuário; depois seguir um commit por tarefa com as mensagens indicadas.
- O teste e2e `tests/e2e/qa-flow.spec.ts` ("release visual matrix") verifica overflow horizontal e navegação cortada — nenhuma regra nova pode causar overflow (sombras e transforms não afetam layout; não aumentar larguras).

---

### Task 1: Fonte Nunito via next/font + themeColor da marca

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css:35`
- Test: `tests/unit/ui-redesign-contracts.test.ts` (criar)

**Interfaces:**
- Produces: CSS variable `--font-nunito` aplicada no `<body>`; todas as tarefas seguintes assumem a fonte ativa.

- [ ] **Step 1: Escrever o teste de contrato (failing)**

Criar `tests/unit/ui-redesign-contracts.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("chunky playful redesign contracts", () => {
  it("loads Nunito via next/font and applies it as the app font", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("next/font/google");
    expect(layout).toContain("Nunito");
    expect(layout).toContain("--font-nunito");
    expect(read("app/globals.css")).toContain("var(--font-nunito)");
  });

  it("uses the new brand color in the PWA theme", () => {
    expect(read("app/layout.tsx")).toContain('themeColor: "#58cc02"');
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL — `app/layout.tsx` não contém "Nunito".

- [ ] **Step 3: Implementar**

Em `app/layout.tsx`, substituir o bloco de imports e adicionar a fonte:

Substituir:
```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegistration } from "@/components/PwaRegistration";
```
Por:
```tsx
import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { PwaRegistration } from "@/components/PwaRegistration";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap"
});
```

Substituir `themeColor: "#217a38"` por `themeColor: "#58cc02"`.

Substituir `<body>` por `<body className={nunito.variable}>`.

Em `app/globals.css:35`, substituir:
```css
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```
Por:
```css
  font-family: var(--font-nunito), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Nota: Nunito é variable font — sem `weight` explícito o next/font carrega o eixo completo (o CSS usa pesos 620–900).

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): fonte Nunito via next/font + themeColor da nova marca"
```

---

### Task 2: Fundação de tokens multi-cor por seção

**Files:**
- Modify: `app/globals.css:1-23` (bloco `:root`)
- Modify: `tests/unit/accessibility-contracts.test.ts:24`
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Produces: tokens `--brand/--chat/--palavras/--calendario/--progresso/--neutral` (cada um com `-deep`/`-soft`), `--section*` (default marca), classes `.section-chat|.section-palavras|.section-calendario|.section-progresso|.section-neutral`, aliases `--primary: var(--section)` e `--primary-soft: var(--section-soft)`, e `--border` (hoje indefinida). Consumido por todas as tarefas seguintes.

- [ ] **Step 1: Estender o teste de contrato (failing)**

Adicionar dentro do `describe` em `tests/unit/ui-redesign-contracts.test.ts`:

```ts
  it("defines the multi-color section palette and fixes --border", () => {
    const css = read("app/globals.css");
    for (const token of [
      "--brand: #58cc02",
      "--chat: #1cb0f6",
      "--palavras: #a560ff",
      "--calendario: #ff9600",
      "--progresso: #ffc800",
      "--neutral: #52667a",
      "--danger: #ff4b4b",
      "--border: var(--line)",
      "--primary: var(--section)",
      "--primary-soft: var(--section-soft)"
    ]) {
      expect(css).toContain(token);
    }
    for (const cls of [".section-chat", ".section-palavras", ".section-calendario", ".section-progresso", ".section-neutral"]) {
      expect(css).toContain(cls);
    }
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Reescrever o `:root`**

Em `app/globals.css`, substituir **integralmente** o bloco das linhas 1-23:

```css
:root {
  --bg: #ffffff;
  --text: #1f1f1f;
  --muted: #666666;
  --subtle: #6f6f6f;
  --line: #e5e5e5;
  --primary: #217a38;
  --primary-soft: #e7f5e9;
  --warning: #805900;
  --warning-soft: #fff3cf;
  --info: #1f64b3;
  --info-soft: #e7f1ff;
  --danger: #bd3f30;
  --danger-soft: #ffe9e5;
  --dark-cta: #111111;
  --surface: #ffffff;
  --nav-height: 86px;
  --screen-pad: 24px;
  --radius-lg: 28px;
  --radius-md: 20px;
  --shadow-soft: 0 16px 40px rgba(31, 31, 31, 0.08);
  color-scheme: light;
}
```

Por:

```css
:root {
  /* Superfícies e texto */
  --bg: #faf8f5;
  --surface: #ffffff;
  --text: #1f1f1f;
  --muted: #66625c;
  --subtle: #6f6a63;
  --line: #e8e2d8;
  --line-deep: #d9d0c2;
  --border: var(--line);

  /* Marca e seções: sólida / deep (sombra 3D) / soft (pastel) */
  --brand: #58cc02;
  --brand-deep: #58a700;
  --brand-soft: #e7f8d5;
  --chat: #1cb0f6;
  --chat-deep: #148fd6;
  --chat-soft: #ddf1fe;
  --palavras: #a560ff;
  --palavras-deep: #8549e8;
  --palavras-soft: #f1e6ff;
  --calendario: #ff9600;
  --calendario-deep: #d97c00;
  --calendario-soft: #ffeed6;
  --progresso: #ffc800;
  --progresso-deep: #c79a00;
  --progresso-soft: #fff3c4;
  --neutral: #52667a;
  --neutral-deep: #3f5062;
  --neutral-soft: #e9eef3;

  /* Semânticas */
  --warning: #805900;
  --warning-soft: #fff3cf;
  --info: #1f64b3;
  --info-soft: #e7f1ff;
  --danger: #ff4b4b;
  --danger-deep: #d9372b;
  --danger-soft: #ffe5e3;
  --dark-cta: #111111;

  /* Seção ativa (default = marca); sobrescrita por .section-* no .phone-shell */
  --section: var(--brand);
  --section-deep: var(--brand-deep);
  --section-soft: var(--brand-soft);
  --section-text: var(--brand-deep);

  /* Aliases legados: seletores existentes herdam a cor da seção */
  --primary: var(--section);
  --primary-soft: var(--section-soft);

  --nav-height: 86px;
  --screen-pad: 24px;
  --radius-lg: 28px;
  --radius-md: 20px;
  --shadow-soft: 0 16px 40px rgba(31, 31, 31, 0.08);
  color-scheme: light;
}

/* Cor de seção por tela — aplicada no .phone-shell via prop `section` do AppShell */
.section-chat { --section: var(--chat); --section-deep: var(--chat-deep); --section-soft: var(--chat-soft); --section-text: var(--chat-deep); }
.section-palavras { --section: var(--palavras); --section-deep: var(--palavras-deep); --section-soft: var(--palavras-soft); --section-text: var(--palavras-deep); }
.section-calendario { --section: var(--calendario); --section-deep: var(--calendario-deep); --section-soft: var(--calendario-soft); --section-text: var(--calendario-deep); }
.section-progresso { --section: var(--progresso); --section-deep: var(--progresso-deep); --section-soft: var(--progresso-soft); --section-text: var(--progresso-deep); }
.section-neutral { --section: var(--neutral); --section-deep: var(--neutral-deep); --section-soft: var(--neutral-soft); --section-text: var(--neutral-deep); }
```

- [ ] **Step 4: Corrigir o teste de acessibilidade existente**

Em `tests/unit/accessibility-contracts.test.ts:24`, substituir:
```ts
    expect(css).toContain("--primary: #217a38");
```
Por:
```ts
    expect(css).toContain("--brand: #58cc02");
```

- [ ] **Step 5: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts tests/unit/accessibility-contracts.test.ts`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tests/unit/ui-redesign-contracts.test.ts tests/unit/accessibility-contracts.test.ts
git commit -m "feat(ui): paleta multi-cor por seção com aliases de seção e fix de --border"
```

---

### Task 3: `AppShell` com prop `section` + cores por tela + recolors

**Files:**
- Modify: `components/AppShell.tsx` (reescrita completa)
- Modify: `app/chat/page.tsx:29,44`
- Modify: `app/palavras/page.tsx:33`, `app/palavras/[wordId]/page.tsx:26`, `app/palavras/treino/page.tsx:7`
- Modify: `app/calendario/page.tsx:27`, `app/calendario/[date]/page.tsx:26`
- Modify: `app/progresso/page.tsx:47,85`
- Modify: `app/perfil/page.tsx:13`, `app/settings/connections/page.tsx:60`
- Modify: `app/resumo/page.tsx:66,135`
- Modify: `app/error.tsx:13`, `app/not-found.tsx:6`, `app/offline/page.tsx:8`
- Modify: `components/HomeDashboard.tsx:154,198`, `components/ChatConversation.tsx:629`
- Modify: `app/globals.css` (anexar bloco de recolors ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `--section*` e `.section-*` da Task 2.
- Produces: `AppShell` aceita `section?: "chat" | "palavras" | "calendario" | "progresso" | "neutral"` e aplica `section-<valor>` no `.phone-shell` (o `BottomNav` é filho do `.phone-shell`, então herda a seção). Consumido pelas Tasks 7 (loadings de rota).

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("applies section classes through AppShell on every routed screen", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain("section-");
    expect(read("app/chat/page.tsx")).toContain('section="chat"');
    expect(read("app/palavras/page.tsx")).toContain('section="palavras"');
    expect(read("app/palavras/treino/page.tsx")).toContain('section="palavras"');
    expect(read("app/calendario/page.tsx")).toContain('section="calendario"');
    expect(read("app/progresso/page.tsx")).toContain('section="progresso"');
    expect(read("app/perfil/page.tsx")).toContain('section="neutral"');
    expect(read("app/resumo/page.tsx")).toContain('section="chat"');
  });

  it("removes hardcoded brand greens from component JSX", () => {
    expect(read("components/HomeDashboard.tsx")).not.toContain('color="#2f9d4a"');
    expect(read("components/ChatConversation.tsx")).not.toContain('color="#2f9d4a"');
    expect(read("app/progresso/page.tsx")).not.toContain('color="#2f9d4a"');
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL nos dois novos testes.

- [ ] **Step 3: Reescrever `components/AppShell.tsx`**

```tsx
import { BottomNav, NavKey } from "./BottomNav";

export type SectionKey = "chat" | "palavras" | "calendario" | "progresso" | "neutral";

type AppShellProps = {
  children: React.ReactNode;
  activeNav?: NavKey;
  noNav?: boolean;
  section?: SectionKey;
};

export function AppShell({ children, activeNav, noNav = false, section }: AppShellProps) {
  const shellClass = section ? `phone-shell section-${section}` : "phone-shell";
  return (
    <>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      <main className={shellClass}>
        <div className={noNav ? "screen no-nav" : "screen"} id="main-content" tabIndex={-1}>{children}</div>
        {!noNav ? <BottomNav active={activeNav} /> : null}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Aplicar `section` nas páginas**

Edições exatas (uma por arquivo):

- `app/chat/page.tsx:29`: `<AppShell activeNav="chat">` → `<AppShell activeNav="chat" section="chat">`
- `app/chat/page.tsx:44`: `<AppShell activeNav="chat" noNav={isActiveTraining}>` → `<AppShell activeNav="chat" noNav={isActiveTraining} section="chat">`
- `app/palavras/page.tsx:33`: `<AppShell activeNav="palavras">` → `<AppShell activeNav="palavras" section="palavras">`
- `app/palavras/[wordId]/page.tsx:26`: `<AppShell activeNav="palavras">` → `<AppShell activeNav="palavras" section="palavras">`
- `app/palavras/treino/page.tsx:7`: `return <AppShell activeNav="palavras"><FlashcardTrainer /></AppShell>;` → `return <AppShell activeNav="palavras" section="palavras"><FlashcardTrainer /></AppShell>;`
- `app/calendario/page.tsx:27`: `<AppShell activeNav="calendario">` → `<AppShell activeNav="calendario" section="calendario">`
- `app/calendario/[date]/page.tsx:26`: `<AppShell activeNav="calendario">` → `<AppShell activeNav="calendario" section="calendario">`
- `app/progresso/page.tsx:47`: `<AppShell>` → `<AppShell section="progresso">`
- `app/perfil/page.tsx:13`: `<AppShell activeNav="perfil">` → `<AppShell activeNav="perfil" section="neutral">`
- `app/settings/connections/page.tsx:60`: `<AppShell activeNav="perfil">` → `<AppShell activeNav="perfil" section="neutral">`
- `app/resumo/page.tsx` (duas ocorrências, linhas 66 e 135): `<AppShell activeNav="chat">` → `<AppShell activeNav="chat" section="chat">`
- `app/error.tsx:13`: `<AppShell noNav>` → `<AppShell noNav section="neutral">`
- `app/not-found.tsx:6`: `<AppShell noNav>` → `<AppShell noNav section="neutral">`
- `app/offline/page.tsx:8`: `<AppShell noNav>` → `<AppShell noNav section="neutral">`

Não alterar: `app/page.tsx` (home = marca, default), `app/onboarding/page.tsx` (marca, default), `app/loading.tsx` (tratado na Task 7).

- [ ] **Step 5: Remover cores hardcoded dos ícones JSX (viram `currentColor`)**

- `components/HomeDashboard.tsx:154`: `<TrendingUp color="#2f9d4a" />` → `<TrendingUp />`
- `components/HomeDashboard.tsx:198`: `<Sparkles color="#2f9d4a" />` → `<Sparkles />`
- `components/ChatConversation.tsx:629`: `<Send color="#2f9d4a" />` → `<Send />`
- `app/progresso/page.tsx:85`: `<Target color="#2f9d4a" />` → `<Target />`

- [ ] **Step 6: Anexar recolors de seção ao fim de `app/globals.css`**

Anexar após a última linha do arquivo:

```css

/* === Recolors de seção: blocos que usavam verde/azul fixos seguem a seção === */
.flashcard-entry { background: linear-gradient(135deg, var(--section-deep), var(--section)); box-shadow: 0 6px 0 var(--section-deep); }
.flashcard-entry .eyebrow { color: var(--section-soft); }
.flashcard-brand { background: var(--section); }
.flashcard-intro { background: linear-gradient(135deg, var(--section-soft), #fff); }
.flashcard-range { accent-color: var(--section); }
.active-recall-card { border: 2px solid var(--section-soft); box-shadow: 0 6px 0 var(--section-soft); }
.flashcard-face.front { border: 2px solid var(--section-soft); }
.flashcard-face.back { background: linear-gradient(145deg, var(--section-deep), var(--section)); }
.flashcard-input-row input:focus { outline-color: var(--section-soft); border-color: var(--section); }
.vocabulary-option.selected { border-color: var(--section); background: var(--section-soft); }
.vocabulary-option input { accent-color: var(--section); }
.recall-rating-grid button.suggested { border-color: var(--section); background: var(--section-soft); color: var(--section-text); box-shadow: inset 0 0 0 1px var(--section); }
.selection-explanation { background: var(--section-soft); }
.progress-level-card, .progress-focus-card { background: var(--section-soft); }
.word-review-states div { background: var(--section-soft); }
```

- [ ] **Step 7: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts tests/unit/accessibility-contracts.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (o prop `section` é opcional, páginas não alteradas continuam válidas).

- [ ] **Step 9: Commit**

```bash
git add components/AppShell.tsx app components/HomeDashboard.tsx components/ChatConversation.tsx tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): prop section no AppShell, cor por tela e recolors de seção"
```

---

### Task 4: Keyframes de animação

**Files:**
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Produces: keyframes `dot-bounce`, `shimmer`, `wave-eq`, `pulse-halo`, `pop-in`, `bounce-in`, `flame-pulse` — consumidos pelas Tasks 5-9.

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("defines the new animation keyframes", () => {
    const css = read("app/globals.css");
    for (const name of ["dot-bounce", "shimmer", "wave-eq", "pulse-halo", "pop-in", "bounce-in", "flame-pulse"]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Anexar os keyframes ao fim de `app/globals.css`**

```css

/* === Animações chunky (neutralizadas por prefers-reduced-motion) === */
@keyframes dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: .55; }
  30% { transform: translateY(-5px); opacity: 1; }
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@keyframes wave-eq {
  0%, 100% { transform: scaleY(.35); }
  50% { transform: scaleY(1); }
}
@keyframes pulse-halo {
  0% { box-shadow: 0 0 0 0 rgba(255, 75, 75, .38); }
  100% { box-shadow: 0 0 0 16px rgba(255, 75, 75, 0); }
}
@keyframes pop-in {
  0% { opacity: 0; transform: translateY(10px) scale(.96); }
  60% { opacity: 1; transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes bounce-in {
  0% { opacity: 0; transform: scale(.4); }
  55% { opacity: 1; transform: scale(1.06); }
  75% { transform: scale(.97); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes flame-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}
```

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): keyframes de animação chunky"
```

---

### Task 5: Camada chunky — botões 3D e cards

**Files:**
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `--section*`, `--line-deep` (Task 2).

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("applies chunky 3D buttons and card borders", () => {
    const css = read("app/globals.css");
    expect(css).toContain("box-shadow: 0 4px 0 var(--section-deep)");
    expect(css).toContain("transform: translateY(4px)");
    expect(css).toContain("box-shadow: 0 3px 0 rgba(31, 25, 16, .05)");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Anexar a camada chunky ao fim de `app/globals.css`**

```css

/* === Camada chunky: botões 3D === */
.outline-button,
.dark-button,
.green-button {
  border-width: 2px;
  border-radius: 16px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 4px 0 var(--line-deep);
  transition: transform .1s ease, box-shadow .1s ease, filter .15s ease;
}
.dark-button { box-shadow: 0 4px 0 #000; }
.green-button {
  border-color: var(--section);
  background: var(--section);
  box-shadow: 0 4px 0 var(--section-deep);
}
.section-progresso .green-button { color: #4a3c00; }
.outline-button:hover:not(:disabled),
.dark-button:hover:not(:disabled),
.green-button:hover:not(:disabled) { filter: brightness(1.04); }
.outline-button:active:not(:disabled),
.dark-button:active:not(:disabled),
.green-button:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 0 0 transparent;
}
.dark-button:disabled,
.green-button:disabled,
.outline-button:disabled {
  transform: none;
  box-shadow: 0 2px 0 var(--line-deep);
}

/* === Camada chunky: cards com borda 2px e sombra sólida sutil === */
.choice-card,
.settings-card,
.topic-card,
.soft-card,
.progress-level-card,
.progress-focus-card,
.calendar-feedback-card {
  border: 2px solid var(--line);
  box-shadow: 0 3px 0 rgba(31, 25, 16, .05);
}
.choice-card { transition: transform .12s ease, box-shadow .12s ease; }
.choice-card:hover { transform: translateY(-2px); box-shadow: 0 5px 0 rgba(31, 25, 16, .07); }
.choice-card.active { border-color: var(--section); }

/* === Textos e ícones sobre fundos claros usam o tom profundo da seção === */
.pill.primary { color: var(--section-text); }
.icon-circle.green { color: var(--section-text); }
.link-action { color: var(--section-text); }
.audio-pill { color: var(--section-text); }
.voice-icon-button { color: var(--section-text); }
.mic-button { color: var(--section-text); }
.nav-item.active { color: var(--section-text); }
.nav-item.active svg { fill: var(--section-text); stroke: var(--section-text); }
```

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): botões 3D chunky, cards com borda 2px e textos em tom profundo"
```

---

### Task 6: `LoadingDots` + indicador de digitação animado no chat

**Files:**
- Create: `components/LoadingDots.tsx`
- Modify: `components/ChatConversation.tsx:552-553` (typing bubble) + import
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `@keyframes dot-bounce` (Task 4), `--section` (Task 2).
- Produces: `LoadingDots({ srText?: string })` — usado também pela Task 7 (`app/loading.tsx`).

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("renders animated typing dots in the chat instead of static text", () => {
    expect(read("components/LoadingDots.tsx")).toContain('role="status"');
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("<LoadingDots");
    expect(chat).toContain('srText="A IA está preparando a próxima resposta..."');
    const css = read("app/globals.css");
    expect(css).toContain(".loading-dot");
    expect(css).toContain("animation: dot-bounce");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL — `components/LoadingDots.tsx` não existe.

- [ ] **Step 3: Criar `components/LoadingDots.tsx`**

```tsx
export function LoadingDots({ srText = "Carregando..." }: { srText?: string }) {
  return (
    <span className="loading-dots" role="status">
      <span className="sr-only">{srText}</span>
      <span aria-hidden="true" className="loading-dot" />
      <span aria-hidden="true" className="loading-dot" />
      <span aria-hidden="true" className="loading-dot" />
    </span>
  );
}
```

- [ ] **Step 4: Usar no chat**

Em `components/ChatConversation.tsx`, adicionar o import junto aos demais componentes:
```tsx
import { LoadingDots } from "@/components/LoadingDots";
```

Substituir (linhas 552-553):
```tsx
            <div className="bubble ai typing-bubble">
              <Loader2 className="spin" /> A IA está preparando a próxima resposta...
            </div>
```
Por:
```tsx
            <div className="bubble ai typing-bubble">
              <LoadingDots srText="A IA está preparando a próxima resposta..." />
            </div>
```

(`Loader2` continua usado em outros pontos do arquivo — manter o import.)

- [ ] **Step 5: Anexar o CSS dos dots ao fim de `app/globals.css`**

```css

/* === Loading: pontinhos saltitantes === */
.loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.loading-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--section);
  animation: dot-bounce 1.05s ease-in-out infinite;
}
.loading-dot:nth-child(3) { animation-delay: .15s; }
.loading-dot:nth-child(4) { animation-delay: .3s; }
```

Nota: os filhos 2, 3 e 4 de `.loading-dots` são os três dots (o filho 1 é o `.sr-only`); por isso os delays caem em `:nth-child(3)` e `:nth-child(4)`.

- [ ] **Step 6: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add components/LoadingDots.tsx components/ChatConversation.tsx app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): LoadingDots animado substitui texto estático de digitação no chat"
```

---

### Task 7: `Skeleton` + loading raiz animado + loadings por rota

**Files:**
- Create: `components/Skeleton.tsx`
- Create: `app/palavras/loading.tsx`, `app/progresso/loading.tsx`, `app/calendario/loading.tsx`
- Modify: `app/loading.tsx` (reescrita)
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `LoadingDots` (Task 6), `@keyframes shimmer/bounce-in` (Task 4), `section` do AppShell (Task 3).
- Produces: `Skeleton({ variant?: "line" | "card" | "circle", width?, height?, className? })`.

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("provides skeleton-based route loading screens", () => {
    expect(read("components/Skeleton.tsx")).toContain("skeleton-");
    expect(read("app/palavras/loading.tsx")).toContain("<Skeleton");
    expect(read("app/progresso/loading.tsx")).toContain("<Skeleton");
    expect(read("app/calendario/loading.tsx")).toContain("<Skeleton");
    expect(read("app/loading.tsx")).toContain("<LoadingDots");
    const css = read("app/globals.css");
    expect(css).toContain("animation: shimmer");
    expect(css).toContain("animation: bounce-in");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL — arquivos `loading.tsx` de rota não existem.

- [ ] **Step 3: Criar `components/Skeleton.tsx`**

```tsx
type SkeletonProps = {
  variant?: "line" | "card" | "circle";
  width?: string | number;
  height?: string | number;
  className?: string;
};

export function Skeleton({ variant = "line", width, height, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={["skeleton", `skeleton-${variant}`, className].filter(Boolean).join(" ")}
      style={{ width, height }}
    />
  );
}
```

- [ ] **Step 4: Reescrever `app/loading.tsx` (loading raiz animado)**

```tsx
import { AppShell } from "@/components/AppShell";
import { LoadingDots } from "@/components/LoadingDots";

export default function Loading() {
  return (
    <AppShell noNav>
      <div className="app-loading" aria-live="polite">
        <span className="loading-mark" aria-hidden="true" />
        <span>Carregando sua prática</span>
        <LoadingDots srText="Carregando sua prática..." />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Criar os loadings de rota com skeletons**

`app/palavras/loading.tsx`:
```tsx
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell activeNav="palavras" section="palavras">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={140} />
        <Skeleton variant="line" width="80%" />
        <Skeleton variant="card" height={220} />
        <Skeleton variant="line" width="45%" />
      </div>
    </AppShell>
  );
}
```

`app/progresso/loading.tsx`:
```tsx
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell section="progresso">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={180} />
        <Skeleton variant="card" height={110} />
        <Skeleton variant="line" width="70%" />
        <Skeleton variant="card" height={140} />
      </div>
    </AppShell>
  );
}
```

`app/calendario/loading.tsx`:
```tsx
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell activeNav="calendario" section="calendario">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={300} />
        <Skeleton variant="card" height={130} />
        <Skeleton variant="card" height={130} />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 6: Anexar o CSS de skeleton + loading-mark ao fim de `app/globals.css`**

```css

/* === Skeletons com shimmer === */
.screen-skeleton { display: grid; gap: 18px; margin-top: 12px; }
.skeleton {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--line) 25%, #f4f0e8 50%, var(--line) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
.skeleton-line { width: 100%; height: 16px; }
.skeleton-card { width: 100%; height: 120px; border-radius: 24px; }
.skeleton-circle { width: 62px; height: 62px; border-radius: 999px; }

/* === Loading de rota: marca saltitante (substitui o ring spinner) === */
.loading-mark {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 18px;
  background: var(--section);
  box-shadow: 0 5px 0 var(--section-deep);
  animation: bounce-in .6s cubic-bezier(.34, 1.56, .64, 1) both;
}
```

- [ ] **Step 7: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/Skeleton.tsx app/loading.tsx app/palavras/loading.tsx app/progresso/loading.tsx app/calendario/loading.tsx app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): skeletons com shimmer e loadings de rota animados"
```

---

### Task 8: Wave de áudio animada + halo pulsante do microfone

**Files:**
- Modify: `components/VoiceButton.tsx:22-32` (`Wave`), `:174` (fill hardcoded), `:175` (uso)
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `@keyframes wave-eq` e `pulse-halo` (Task 4).

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("animates the audio wave while playing and the mic halo while listening", () => {
    const voice = read("components/VoiceButton.tsx");
    expect(voice).toContain("wave playing");
    expect(voice).not.toContain("#217a38");
    const css = read("app/globals.css");
    expect(css).toContain(".wave.playing span");
    expect(css).toContain("animation: wave-eq");
    expect(css).toContain(".mic-button.listening");
    expect(css).toContain("animation: pulse-halo");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Implementar no `components/VoiceButton.tsx`**

Substituir a função `Wave` (linhas 22-32):
```tsx
function Wave() {
  return (
    <span className="wave" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
```
Por:
```tsx
function Wave({ playing = false }: { playing?: boolean }) {
  return (
    <span className={playing ? "wave playing" : "wave"} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
```

Substituir a linha 174-175:
```tsx
      <StatusIcon className={status === "loading" ? "spin" : undefined} fill={StatusIcon === Play ? "#217a38" : undefined} />
      <Wave />
```
Por:
```tsx
      <StatusIcon className={status === "loading" ? "spin" : undefined} />
      <Wave playing={status === "playing"} />
```

- [ ] **Step 4: Anexar o CSS ao fim de `app/globals.css`**

```css

/* === Wave: equalizador animado durante a reprodução === */
.wave span { transform-origin: center; }
.wave.playing span { animation: wave-eq .9s ease-in-out infinite; }
.wave.playing span:nth-child(1) { animation-delay: 0s; }
.wave.playing span:nth-child(2) { animation-delay: .12s; }
.wave.playing span:nth-child(3) { animation-delay: .24s; }
.wave.playing span:nth-child(4) { animation-delay: .36s; }
.wave.playing span:nth-child(5) { animation-delay: .48s; }

/* === Microfone ouvindo: halo pulsante === */
.mic-button.listening {
  animation: pulse-halo 1.6s ease-out infinite;
}
```

- [ ] **Step 5: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/VoiceButton.tsx app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): wave equalizador animada e halo pulsante no microfone"
```

---

### Task 9: Micro-interações chunky

**Files:**
- Modify: `app/globals.css` (anexar ao fim)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: `@keyframes pop-in` e `flame-pulse` (Task 4).

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("adds chunky micro-interactions", () => {
    const css = read("app/globals.css");
    expect(css).toContain(".chat-row { animation: pop-in");
    expect(css).toContain("lucide-flame");
    expect(css).toContain("animation: flame-pulse");
    expect(css).toContain(".flashcard-card-inner");
    expect(css).toContain("cubic-bezier(.34, 1.3, .64, 1)");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Anexar ao fim de `app/globals.css`**

```css

/* === Micro-interações chunky === */
.chat-row { animation: pop-in .38s cubic-bezier(.34, 1.4, .64, 1) both; }
.pill svg.lucide-flame { transform-origin: center; animation: flame-pulse 1.8s ease-in-out infinite; }
.flashcard-card-inner { transition: transform .55s cubic-bezier(.34, 1.3, .64, 1); }
.list-row { transition: transform .12s ease, box-shadow .12s ease; }
```

Notas:
- `.chat-row` anima cada mensagem ao montar (entrada elástica); em histórico longo todas animam juntas por ~380ms — efeito de "subida" única, aceitável (validar no QA da Task 10).
- `lucide-react` adiciona as classes `lucide lucide-flame` automaticamente no svg do ícone `Flame`, usado dentro de `Pill` nos streaks (`ScreenHeader`, home, progresso).

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/globals.css tests/unit/ui-redesign-contracts.test.ts
git commit -m "feat(ui): micro-interações chunky (pop-in, chama do streak, flip spring)"
```

---

### Task 10: Documentação de tokens + verificação completa + QA visual

**Files:**
- Modify: `docs/DESIGN_TOKENS.md` (reescrita completa)
- Test: `tests/unit/ui-redesign-contracts.test.ts` (estender)

**Interfaces:**
- Consumes: tudo das tasks anteriores.

- [ ] **Step 1: Estender o teste de contrato (failing)**

```ts
  it("documents the new token system", () => {
    const doc = read("docs/DESIGN_TOKENS.md");
    expect(doc).toContain("--brand: #58cc02");
    expect(doc).toContain("--section");
    expect(doc).toContain("Nunito");
  });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: FAIL no novo teste.

- [ ] **Step 3: Reescrever `docs/DESIGN_TOKENS.md`**

Substituir o conteúdo inteiro por:

```markdown
# Design Tokens — AI Fluency

Fonte da verdade: `app/globals.css` (`:root` + blocos anexados ao fim). Este documento descreve o sistema; em caso de divergência, o CSS vence.

## Identidade

- Estilo: "chunky playful" — cartunesco e colorido estilo Duolingo, sem ser infantil (público adulto).
- Fonte: `Nunito` (variable, pesos usados 620–900), carregada via `next/font` em `app/layout.tsx` como `--font-nunito`.
- Fundo do app: off-white quente `--bg: #faf8f5`.

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

Mecanismo: `AppShell` recebe `section` e aplica `.section-<valor>` no `.phone-shell`, que define `--section`, `--section-deep`, `--section-soft`, `--section-text`. Componentes consomem essas variáveis. Aliases legados `--primary: var(--section)` e `--primary-soft: var(--section-soft)` mantêm seletores antigos section-aware. Textos/ícones sobre fundos claros usam `--section-text` (contraste).

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
```

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/ui-redesign-contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Verificação completa**

Run, em sequência, e confira cada saída:
1. `npm run lint` — Expected: sem erros
2. `npm run typecheck` — Expected: sem erros
3. `npm run test:unit` — Expected: todos os testes PASS (inclui accessibility-contracts e ui-redesign-contracts)
4. `npm run build` — Expected: build completa sem erros (valida que `next/font` baixa a Nunito e que os `loading.tsx` compilam)
5. `npx playwright test tests/e2e/qa-flow.spec.ts -g "visual matrix"` — Expected: PASS (sem overflow horizontal nem navegação cortada). Se o ambiente de QA/e2e não estiver disponível, anotar e cobrir com o QA visual do Step 6.

- [ ] **Step 6: QA visual com screenshots**

1. Subir o dev server: `npm run dev` (background).
2. Screenshot das rotas `/`, `/chat`, `/palavras`, `/progresso`, `/calendario`, `/perfil` em viewport 390×844 com um script Playwright descartável em `.qa-fixtures/redesign-shots.mjs`:

```js
import { chromium } from "@playwright/test";

const routes = ["/", "/chat", "/palavras", "/progresso", "/calendario", "/perfil"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const route of routes) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `.qa-fixtures/shot${route.replaceAll("/", "-")}.png`, fullPage: true });
}
await browser.close();
```

3. Inspecionar cada screenshot com ReadMediaFile e corrigir glitches visuais (contraste fraco, animação estranha, cor de seção errada, overflow). Se o middleware redirecionar para `/onboarding` (sem perfil seedado), screenshotar o que renderizar e pedir ao usuário uma verificação manual nas demais telas.
4. Remover o script descartável ao final (manter screenshots em `.qa-fixtures` para o usuário ver).

- [ ] **Step 7: Commit**

```bash
git add docs/DESIGN_TOKENS.md tests/unit/ui-redesign-contracts.test.ts app/globals.css
git commit -m "docs(ui): sistema de tokens chunky playful documentado"
```

---

## Self-Review do plano (já executado pelo autor)

- **Spec coverage:** tokens multi-cor (T2/T3), fonte (T1), correções de base `--border`/verdes/inline (T2/T3), sistema de loadings (T6/T7/T8), micro-interações (T5/T9), todas as telas (T3), docs (T10), testes e verificação (cada task + T10). Sem gaps.
- **Placeholders:** nenhum — todo passo tem código/comando completo.
- **Type consistency:** `SectionKey` (T3) = valores usados nas páginas e nos loadings de rota (T7); `LoadingDots({ srText })` (T6) = uso em `app/loading.tsx` (T7); `Skeleton({ variant, width, height, className })` (T7) = uso nos três loadings; keyframes (T4) = nomes consumidos em T6/T7/T8/T9.
