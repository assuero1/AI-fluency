# Plano 1 — Juice (P0): micro-recompensas e celebração

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app festejar — sons de acerto/erro/conclusão, vibração, confetti, troféu animado, score com contagem, celebração da meta da conversa, micro-recompensa por correção e fechamento dos loops mortos de fim de sessão — **sem nenhuma mudança de banco de dados** (100% frontend).

**Architecture:** Três módulos client novos (`ui-sound` expandido, `haptics`, `confetti`) + um componente compartilhado `SessionCelebration` + um componente `CountUp`. Os treinadores e o chat passam a disparar recompensas nos momentos de veredito e conclusão. Loops de continuidade usam a API de treino por `wordIds` que **já existe** no servidor (`createFlashcardPractice` aceita `wordIds`, `lib/learning/flashcards.ts:235-246`), com handoff via `sessionStorage` para entrar no treino sem toque extra.

**Tech Stack:** Next.js 15 + React 19, Web Audio API (osciladores, sem assets), `navigator.vibrate`, Canvas 2D, CSS keyframes existentes (`bounce-in`, `pop-in`).

**Spec:** [docs/ESTUDO_ENGAJAMENTO_RETENCAO.md](../../ESTUDO_ENGAJAMENTO_RETENCAO.md) — seção 4, itens R1, R2, R3, R4 e o fix de confirmação de saída (R9d). Este plano implementa a **Fase 1** do roadmap.

## Global Constraints

- Nenhuma migração de banco, nenhuma dependência nova de npm.
- Todo som é sintetizado via Web Audio (osciladores); ganho pico ≤ 0.14; falha de áudio é sempre silenciosa (padrão do arquivo atual).
- `prefers-reduced-motion: reduce` desliga confetti e animações decorativas (a contagem funcional de 4s do auto-avanço permanece, como hoje).
- AudioContext só toca depois de gesto do usuário; onde não houver gesto (resumo é server-rendered), o som simplesmente não toca (try/catch silencioso) — confetti/animação compensam.
- UI e comentários em pt-BR, seguindo o tom do app.
- Antes do push: **bump do `CACHE_NAME` em `public/sw.js`** (PWA do celular fica preso na versão velha sem isso).
- Commits pequenos por task; mensagens no padrão do repo (`feat:`, `fix:`).

## Supersessões (decisões "deixa o melhor")

| Deixa de existir | Substituído por |
|---|---|
| `playButtonSound` como única função de som | `playSound(name)` com catálogo; `playButtonSound` vira alias deprecated |
| Resultado estático dos 2 treinadores | `SessionCelebration` (troféu animado + confetti + count-up) |
| "Sair" silencioso do treino de palavras novas | Modal de confirmação (paridade com flashcards) |

## File Structure

- Create: `lib/client/haptics.ts` — vibração com feature-detect e opt-out
- Create: `lib/client/confetti.ts` — canvas 2D sem dependência
- Create: `components/CountUp.tsx` — número animado
- Create: `components/SessionCelebration.tsx` — wrapper de celebração de resultado
- Create: `components/ResumoPracticeCta.tsx` — CTA "Treinar N palavras desta conversa" (client)
- Create: `components/StartFlashcardsWithWords.tsx` — handoff sessionStorage → treino (client)
- Modify: `lib/client/ui-sound.ts` — catálogo de sons + mute
- Modify: `components/NewWordsTrainer.tsx` — sons de veredito, celebração, modal de saída, CTA de cards
- Modify: `components/FlashcardTrainer.tsx` — sons de veredito, celebração
- Modify: `app/resumo/page.tsx` — confetti + CTA de treino
- Modify: `components/ConversationGoalProgress.tsx` + `components/ChatConversation.tsx` — festa da meta + finalizar dali
- Modify: `components/ChatConversation.tsx` — micro-recompensa de correção
- Modify: `components/ProfilePreferences.tsx` — toggles de som/vibração
- Modify: `app/globals.css` — keyframes/classes novos
- Modify: `public/sw.js` — bump de cache (última task)
- Test: `tests/unit/ui-sound-catalog.test.ts`

---

### Task 1: Catálogo de sons em `ui-sound.ts` + mute

**Files:**
- Modify: `lib/client/ui-sound.ts` (arquivo inteiro, 26 linhas hoje)
- Test: `tests/unit/ui-sound-catalog.test.ts`

**Interfaces:**
- Produces: `playSound(name: SoundName): void`, `SoundName` = `"button" | "correct" | "neutral" | "wrong" | "goal" | "complete" | "achievement"`, `isSoundEnabled(): boolean`, `setSoundEnabled(value: boolean): void`, e mantém `playButtonSound()` (alias de `playSound("button")`) para não quebrar o chamador atual (`NewWordsTrainer.tsx:19,296`).

- [ ] **Step 1: Escrever o teste do catálogo (falha primeiro)**

```ts
// tests/unit/ui-sound-catalog.test.ts
import { describe, expect, it } from "vitest";
import { SOUND_CATALOG, SOUND_NAMES } from "@/lib/client/ui-sound";

describe("SOUND_CATALOG", () => {
  it("expõe exatamente os sons do catálogo", () => {
    expect([...SOUND_NAMES].sort()).toEqual(["achievement", "button", "complete", "correct", "goal", "neutral", "wrong"]);
  });

  it("cada som tem notas e ganho dentro dos limites do app", () => {
    for (const name of SOUND_NAMES) {
      const sound = SOUND_CATALOG[name];
      expect(sound.notes.length, name).toBeGreaterThan(0);
      expect(sound.gain, name).toBeGreaterThan(0);
      expect(sound.gain, name).toBeLessThanOrEqual(0.14);
      for (const note of sound.notes) {
        expect(note.frequency, name).toBeGreaterThan(80);
        expect(note.frequency, name).toBeLessThan(2200);
        expect(note.startAt, name).toBeGreaterThanOrEqual(0);
        expect(note.duration, name).toBeGreaterThan(0);
      }
    }
  });
});
```

Run: `npx vitest run tests/unit/ui-sound-catalog.test.ts`
Expected: FAIL (`SOUND_CATALOG is not exported`)

- [ ] **Step 2: Implementar o catálogo + engine**

Substituir o conteúdo de `lib/client/ui-sound.ts` por:

```ts
let ctx: AudioContext | null = null;

export const SOUND_NAMES = ["button", "correct", "neutral", "wrong", "goal", "complete", "achievement"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export type SoundNote = { frequency: number; startAt: number; duration: number; type?: OscillatorType };
export type SoundSpec = { notes: SoundNote[]; gain: number };

// Notas curtas e suaves: feedback positivo sobe, negativo desce. Ganho baixo
// de propósito — o som acompanha, nunca atrapalha.
export const SOUND_CATALOG: Record<SoundName, SoundSpec> = {
  button: { gain: 0.12, notes: [{ frequency: 880, startAt: 0, duration: 0.09, type: "sine" }] },
  correct: { gain: 0.1, notes: [
    { frequency: 659, startAt: 0, duration: 0.09, type: "triangle" },
    { frequency: 880, startAt: 0.08, duration: 0.12, type: "triangle" }
  ] },
  neutral: { gain: 0.09, notes: [{ frequency: 440, startAt: 0, duration: 0.12, type: "triangle" }] },
  wrong: { gain: 0.09, notes: [
    { frequency: 220, startAt: 0, duration: 0.14, type: "sine" },
    { frequency: 165, startAt: 0.1, duration: 0.16, type: "sine" }
  ] },
  goal: { gain: 0.11, notes: [
    { frequency: 523, startAt: 0, duration: 0.1, type: "triangle" },
    { frequency: 659, startAt: 0.09, duration: 0.1, type: "triangle" },
    { frequency: 784, startAt: 0.18, duration: 0.16, type: "triangle" }
  ] },
  complete: { gain: 0.12, notes: [
    { frequency: 523, startAt: 0, duration: 0.12, type: "triangle" },
    { frequency: 659, startAt: 0.11, duration: 0.12, type: "triangle" },
    { frequency: 784, startAt: 0.22, duration: 0.12, type: "triangle" },
    { frequency: 1046, startAt: 0.33, duration: 0.24, type: "triangle" }
  ] },
  achievement: { gain: 0.12, notes: [
    { frequency: 523, startAt: 0, duration: 0.1, type: "triangle" },
    { frequency: 659, startAt: 0.1, duration: 0.1, type: "triangle" },
    { frequency: 784, startAt: 0.2, duration: 0.1, type: "triangle" },
    { frequency: 1046, startAt: 0.3, duration: 0.14, type: "triangle" },
    { frequency: 1318, startAt: 0.42, duration: 0.22, type: "triangle" }
  ] }
};

const SOUND_ENABLED_KEY = "ai-fluency:sound-enabled";

export function isSoundEnabled() {
  try { return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "0"; } catch { return true; }
}

export function setSoundEnabled(value: boolean) {
  try { window.localStorage.setItem(SOUND_ENABLED_KEY, value ? "1" : "0"); } catch { /* storage bloqueado */ }
}

export function playSound(name: SoundName) {
  if (!isSoundEnabled()) return;
  try {
    const spec = SOUND_CATALOG[name];
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    for (const note of spec.notes) {
      const gain = ctx.createGain();
      const start = now + note.startAt;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = note.type ?? "sine";
      osc.frequency.setValueAtTime(note.frequency, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + note.duration + 0.02);
    }
  } catch {
    // Som é cosmético: qualquer falha (ex.: AudioContext bloqueado) é silenciosa.
  }
}

/** @deprecated use playSound("button") */
export function playButtonSound() {
  playSound("button");
}
```

- [ ] **Step 3: Rodar o teste (passa)**

Run: `npx vitest run tests/unit/ui-sound-catalog.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: sem erros (o chamador `playButtonSound` continua existindo)

- [ ] **Step 4: Commit**

```bash
git add lib/client/ui-sound.ts tests/unit/ui-sound-catalog.test.ts
git commit -m "feat(juice): catálogo de sons sintetizados com mute persistido"
```

---

### Task 2: Haptics (`navigator.vibrate`)

**Files:**
- Create: `lib/client/haptics.ts`

**Interfaces:**
- Produces: `vibrate(pattern: VibratePatternName)` com `VibratePatternName = "tap" | "success" | "warn" | "celebrate"`; `isHapticsEnabled()`, `setHapticsEnabled(value: boolean)` (localStorage `ai-fluency:haptics-enabled`, padrão ligado). iOS Safari ignora `navigator.vibrate` — feature-detect evita erro.

- [ ] **Step 1: Implementar**

```ts
// lib/client/haptics.ts
const HAPTICS_ENABLED_KEY = "ai-fluency:haptics-enabled";

// Sem `as const`: tuplas readonly não são atribuíveis a VibratePattern (number | number[]).
const PATTERNS = {
  tap: 15,
  success: [18, 40, 18],
  warn: [30, 50, 30],
  celebrate: [20, 50, 20, 50, 40]
};

export type VibratePatternName = keyof typeof PATTERNS;

export function isHapticsEnabled() {
  try { return window.localStorage.getItem(HAPTICS_ENABLED_KEY) !== "0"; } catch { return true; }
}

export function setHapticsEnabled(value: boolean) {
  try { window.localStorage.setItem(HAPTICS_ENABLED_KEY, value ? "1" : "0"); } catch { /* storage bloqueado */ }
}

export function vibrate(pattern: VibratePatternName) {
  if (!isHapticsEnabled()) return;
  try { navigator.vibrate?.(PATTERNS[pattern]); } catch { /* sem suporte (ex.: iOS) */ }
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: ok

- [ ] **Step 3: Commit**

```bash
git add lib/client/haptics.ts
git commit -m "feat(juice): haptics com feature-detect e opt-out"
```

---

### Task 3: Confetti em canvas + `CountUp`

**Files:**
- Create: `lib/client/confetti.ts`
- Create: `components/CountUp.tsx`

**Interfaces:**
- Produces: `burstConfetti(options?: { particles?: number; originY?: number }): void` — cria um `<canvas>` fixo sobre a tela, anima ~1.8s e se remove sozinho. No-op se `prefers-reduced-motion: reduce`.
- Produces: `components/CountUp` — props `{ value: number; suffix?: string; className?: string; durationMs?: number }`; anima 0→`value` em ~900ms; com movimento reduzido renderiza o valor final direto.

- [ ] **Step 1: Implementar confetti**

```ts
// lib/client/confetti.ts
const PALETTE = ["#2f9d4a", "#58cc02", "#f7c948", "#1f7a33", "#8fd6a0"];

export function burstConfetti(options: { particles?: number; originY?: number } = {}) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "9999" } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(canvas);
    const context = canvas.getContext("2d");
    if (!context) { canvas.remove(); return; }
    context.scale(dpr, dpr);

    const count = Math.max(20, Math.min(180, options.particles ?? 90));
    const originY = options.originY ?? window.innerHeight * 0.28;
    const particles = Array.from({ length: count }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: originY,
      vx: (Math.random() - 0.5) * 9,
      vy: -(4 + Math.random() * 7),
      size: 5 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      speed: 0.15 + Math.random() * 0.25,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]
    }));

    const startedAt = performance.now();
    const frame = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.22 * particle.speed * 2;
        particle.rotation += 0.08;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = Math.max(0, 1 - elapsed / 1800);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
        context.restore();
      }
      if (elapsed < 1900) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  } catch {
    // Confetti é cosmético: falha não pode interromper a celebração.
  }
}
```

- [ ] **Step 2: Implementar CountUp**

```tsx
// components/CountUp.tsx
"use client";

import { useEffect, useState } from "react";

type CountUpProps = { value: number; suffix?: string; className?: string; durationMs?: number };

export function CountUp({ value, suffix = "", className, durationMs = 900 }: CountUpProps) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplayed(value); return; }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className={className}>{displayed}{suffix}</span>;
}
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: ok

- [ ] **Step 4: Commit**

```bash
git add lib/client/confetti.ts components/CountUp.tsx
git commit -m "feat(juice): confetti em canvas e contagem animada de números"
```

---

### Task 4: `SessionCelebration` + CSS de celebração

**Files:**
- Create: `components/SessionCelebration.tsx`
- Modify: `app/globals.css` (no bloco "Micro-interações chunky", após a linha de `.chat-row`)

**Interfaces:**
- Produces: `SessionCelebration` — props `{ score: number; eyebrow: string; children?: ReactNode }`. É um componente **client** que, ao montar: toca `playSound("complete")`, vibra `celebrate`, dispara `burstConfetti()`, anima o troféu com `bounce-in` e mostra o score com `CountUp`. Children (detalhes do resultado) ficam entre o cabeçalho celebrado e os CTAs — ver uso nas Tasks 5/6.

- [ ] **Step 1: Implementar o componente**

```tsx
// components/SessionCelebration.tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Trophy } from "lucide-react";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";
import { CountUp } from "./CountUp";

type SessionCelebrationProps = { score: number; eyebrow: string; children?: ReactNode };

// Festa padrão de fim de sessão: som + vibração + confetti + troféu quicando
// e score contando. Dispara UMA vez por montagem (StrictMode remonta no dev:
// o guard evita fanfarra dupla).
export function SessionCelebration({ score, eyebrow, children }: SessionCelebrationProps) {
  // O guard em ref sobrevive ao remount do StrictMode (dev): sem ele a
  // fanfarra toca duas vezes na mesma montagem.
  const celebratedRef = useRef(false);

  useEffect(() => {
    if (celebratedRef.current) return;
    celebratedRef.current = true;
    playSound("complete");
    vibrate("celebrate");
    burstConfetti({ particles: score >= 80 ? 130 : 70 });
  }, [score]);

  return <>
    <div className="flashcard-trophy celebrate"><Trophy /></div>
    <div className="eyebrow">{eyebrow}</div>
    <h1 className="title"><CountUp value={score} suffix="% de acerto" /></h1>
    {children}
  </>;
}
```

- [ ] **Step 2: Adicionar o CSS**

Em `app/globals.css`, no bloco "Micro-interações chunky" (após a linha de `.chat-row`):

```css
/* === Celebração de fim de sessão === */
.flashcard-trophy.celebrate { animation: bounce-in .7s cubic-bezier(.34, 1.56, .64, 1) both, mark-float 2.2s ease-in-out .7s infinite; }
.correction-award { display: inline-flex; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #e8f7eb; color: #237a3b; font-size: 12px; font-weight: 800; animation: pop-in .45s cubic-bezier(.34, 1.4, .64, 1) .15s both; }
.correction-block { animation: pop-in .38s cubic-bezier(.34, 1.4, .64, 1) .1s both; }
.message-goal.reached-fireworks { border-color: var(--section); animation: bounce-in .5s cubic-bezier(.34, 1.56, .64, 1) both; }
.pop-in { animation: pop-in .38s cubic-bezier(.34, 1.4, .64, 1) both; }
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
Expected: ok

- [ ] **Step 4: Commit**

```bash
git add components/SessionCelebration.tsx app/globals.css
git commit -m "feat(juice): componente de celebração de fim de sessão"
```

---

### Task 5: Celebrar nos treinadores (veredito + resultado) e fechar loops do treino de palavras novas

**Files:**
- Modify: `components/NewWordsTrainer.tsx` (imports ~linha 19; veredito `submitTranslation` ~309-347; resultado `:432-452`; saída `:459`)
- Modify: `components/FlashcardTrainer.tsx` (veredito `submitAttempt` ~131-150; resultado `:254-273`)
- Create: `components/StartFlashcardsWithWords.tsx`

**Interfaces:**
- Consumes: `playSound`, `vibrate`, `SessionCelebration`, `StartFlashcardsWithWords`.
- Produces: `StartFlashcardsWithWords` — props `{ wordIds: string[]; label?: string; disabled?: boolean }`. POST em `/api/practice/flashcards` com `{ wordIds }` (o servidor já aceita; `flashcards.ts:235-246`), guarda o payload de sessão em `sessionStorage["ai-fluency:pending-flashcards"]` e navega para `/palavras/treino`, que consome o storage na montagem (Task 5 Step 4) para entrar direto no treino.

- [ ] **Step 1: `StartFlashcardsWithWords`**

```tsx
// components/StartFlashcardsWithWords.tsx
"use client";

import { Brain } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type StartFlashcardsWithWordsProps = { wordIds: string[]; label: string; disabled?: boolean };

type CreatedSession = { ok?: boolean; sessionId?: string; cards?: unknown[]; languageCode?: string; languageName?: string; adapted?: boolean; error?: string };

export function StartFlashcardsWithWords({ wordIds, label, disabled }: StartFlashcardsWithWordsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (!wordIds.length || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wordIds }) });
      const data = await response.json() as CreatedSession;
      if (!response.ok || !data.ok || !data.sessionId) throw new Error(data.error ?? "Não foi possível montar o treino.");
      // Handoff 1-toque: o trainer encontra esta sessão no mount e entra direto.
      sessionStorage.setItem("ai-fluency:pending-flashcards", JSON.stringify(data));
      router.push("/palavras/treino");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível montar o treino.");
      setBusy(false);
    }
  }

  return <>
    <button className="outline-button full-button" disabled={disabled || busy || !wordIds.length} onClick={() => void start()} type="button"><Brain /> {label}</button>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </>;
}
```

- [ ] **Step 2: Veredito com som/vibração no `NewWordsTrainer`**

No caminho do match exato (`NewWordsTrainer.tsx:310`, logo após `setJudgment({ verdict: "correct", ... })`):

```ts
      setJudgment({ verdict: "correct", feedback: "", correctedTranslation: current.translation });
      playSound("correct");
      vibrate("success");
```

No caminho julgado pela IA (após `setJudgment(data.attempt.judgment); setSenseCreated(...)` em `:342`):

```ts
      setJudgment(data.attempt.judgment); setSenseCreated(Boolean(data.attempt.senseCreated));
      const verdict = data.attempt.judgment.verdict;
      if (verdict === "correct" || verdict === "acceptable") { playSound("correct"); vibrate("success"); }
      else if (verdict === "minor_error") playSound("neutral");
      else { playSound("wrong"); vibrate("warn"); }
      if (data.attempt.senseCreated) playSound("achievement");
```

Imports no topo: substituir `import { playButtonSound } from "@/lib/client/ui-sound";` por `import { playSound } from "@/lib/client/ui-sound";` e trocar a chamada `playButtonSound()` de `:296` por `playSound("button")`; adicionar `import { vibrate } from "@/lib/client/haptics";`.

- [ ] **Step 3: Resultado com celebração + CTA de cards**

No bloco do resultado (`NewWordsTrainer.tsx:435-439`), substituir trophy/eyebrow/título por `SessionCelebration` e trocar o bloco de CTAs:

```tsx
  if (result) return shell(<div className="flashcard-screen">
    <audio ref={audioRef} className="sr-only" preload="auto" />
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-result">
      <SessionCelebration eyebrow="Sessão concluída" score={result.score} />
      <p className="subtitle">Você aprendeu {result.wordCount} palavra{result.wordCount === 1 ? "" : "s"} nova{result.wordCount === 1 ? "" : "s"} com {result.sentenceCount} frases.</p>
      <div className="flashcard-result-grid">
        <div><strong>{result.wordCount}</strong><span>palavras novas</span></div>
        <div><strong>{result.correctSentences}/{result.sentenceCount}</strong><span>frases certas</span></div>
        <div><strong>{result.newSensesAdded}</strong><span>novos significados</span></div>
      </div>
      <section className="flashcard-result-details" aria-label="Palavras aprendidas">
        {result.words.map((word) => <div key={word.wordId}><span>{word.lemma}</span><strong>{word.translation}</strong></div>)}
      </section>
      <button className="green-button full-button" onClick={() => { setResult(null); setSentences([]); setWords([]); setAnsweredIds(new Set()); }} type="button"><Sparkles /> Aprender mais palavras</button>
      <StartFlashcardsWithWords label="Revisar em cards" wordIds={result.words.map((word) => word.wordId)} />
      <Link className="outline-button full-button" href="/palavras">Voltar às palavras</Link>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  </div>, false);
```

(Importar `SessionCelebration` e `StartFlashcardsWithWords`.)

- [ ] **Step 4: Consumir o handoff no `FlashcardTrainer` + veredito com som**

No `useEffect` de montagem (`FlashcardTrainer.tsx:89-91`), antes de `loadOverview()`:

```ts
  useEffect(() => {
    const pending = sessionStorage.getItem("ai-fluency:pending-flashcards");
    if (pending) {
      sessionStorage.removeItem("ai-fluency:pending-flashcards");
      try {
        const data = JSON.parse(pending) as { sessionId: string; cards: Flashcard[]; languageCode?: string; languageName?: string; adapted?: boolean };
        if (data.sessionId && data.cards?.length) {
          const initialQueue = createFlashcardQueue(data.cards);
          setSessionId(data.sessionId); setCompletionId(crypto.randomUUID()); setCards(data.cards); setQueue(initialQueue); setCurrentItem(selectNextQueueItem(initialQueue, 0));
          setLanguageCode(data.languageCode ?? "es"); setLanguageName(data.languageName ?? "idioma estudado"); setAdapted(data.adapted === true);
          return; // entrada direta: não mostra o resumo/modal
        }
      } catch { /* payload inválido: segue o fluxo normal */ }
    }
    void loadOverview();
  }, []);
```

Em `submitAttempt` (`FlashcardTrainer.tsx:146`), após cada `setRevealed(...)` bem-sucedido (os dois caminhos: preview OK e fallback), adicionar o mesmo feedback — extrair helper no fim do arquivo e chamar:

```ts
function celebrateMatch(revealed: { forgot: boolean; match: AnswerMatch }) {
  if (revealed.forgot || revealed.match === "incorrect" || revealed.match === "unknown") { playSound("wrong"); vibrate("warn"); return; }
  if (revealed.match === "minor_error") { playSound("neutral"); return; }
  playSound("correct");
  vibrate("success");
}
```

No resultado (`FlashcardTrainer.tsx:257`), substituir `<div className="flashcard-trophy"><Trophy /></div><div className="eyebrow">Treino concluído</div><h1 className="title">{result.score}% de acerto</h1>` por `<SessionCelebration eyebrow="Treino concluído" score={result.score} />` (remover `Trophy` do import se ficar sem uso).

- [ ] **Step 5: Modal de confirmação ao sair do treino de palavras novas**

Em `NewWordsTrainer.tsx`: adicionar estado `const [exitOpen, setExitOpen] = useState(false);` perto dos outros; trocar o botão "Sair" (`:459`) de `onClick={() => void abandonSession()}` para `onClick={() => setExitOpen(true)}`; e renderizar o modal (mesmo markup do de flashcards, `FlashcardTrainer.tsx:317`), dentro do `<div className="flashcard-screen">` da sessão ativa:

```tsx
      {exitOpen ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="leave-new-words-title" aria-modal="true" className="confirmation-modal" role="dialog">
        <h2 className="section-title" id="leave-new-words-title">Sair da sessão?</h2>
        <p className="row-meta">As frases já traduzidas continuam valendo. Se sair agora, as frases pendentes não entram na revisão de hoje.</p>
        <div className="modal-actions">
          <button className="outline-button" disabled={busy} onClick={() => setExitOpen(false)} type="button">Continuar traduzindo</button>
          <button className="danger-button" disabled={busy} onClick={() => { setExitOpen(false); void abandonSession(); }} type="button">Sair e abandonar</button>
        </div>
      </section></div> : null}
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: ok

QA manual (dev): concluir uma sessão de cada treinador → fanfarra + confetti + score conta; acertar/errar cartas → sons distintos; "Revisar em cards" no fim de palavras novas → entra direto no treino com as mesmas palavras; "Sair" no meio → modal.

- [ ] **Step 7: Commit**

```bash
git add components/NewWordsTrainer.tsx components/FlashcardTrainer.tsx components/StartFlashcardsWithWords.tsx
git commit -m "feat(juice): celebração nos treinadores, veredito sonoro e loop para cards"
```

---

### Task 6: Resumo — confetti, elogio animado e CTA "Treinar as palavras desta conversa"

**Files:**
- Create: `components/ResumoPracticeCta.tsx`
- Modify: `app/resumo/page.tsx`

**Interfaces:**
- Consumes: `data.words` de `getConversationSummary` (palavras já salvas da conversa; `feedback.ts:187+`), `StartFlashcardsWithWords`.
- Produces: `ResumoPracticeCta` — props `{ wordIds: string[] }`; renderiza nada se `wordIds.length === 0`; acima de 30 palavras corta para 30 (limite do servidor, `flashcards.ts:236`).

- [ ] **Step 1: `ResumoPracticeCta`**

```tsx
// components/ResumoPracticeCta.tsx
"use client";

import { StartFlashcardsWithWords } from "./StartFlashcardsWithWords";

export function ResumoPracticeCta({ wordIds }: { wordIds: string[] }) {
  const capped = wordIds.slice(0, 30);
  if (!capped.length) return null;
  return <StartFlashcardsWithWords label={`Treinar as ${capped.length} palavra${capped.length === 1 ? "" : "s"} desta conversa`} wordIds={capped} />;
}
```

- [ ] **Step 2: Integrar no `app/resumo/page.tsx`**

(a) Criar `components/ResumoConfetti.tsx` (client, sem som — a página abre sem gesto, e o AudioContext pode estar bloqueado; o confetti compensa):

```tsx
// components/ResumoConfetti.tsx
"use client";

import { useEffect } from "react";
import { burstConfetti } from "@/lib/client/confetti";

export function ResumoConfetti() {
  useEffect(() => { burstConfetti({ particles: 90 }); }, []);
  return null;
}
```

(b) No `app/resumo/page.tsx`: importar `ResumoConfetti` e `ResumoPracticeCta`; renderizar `<ResumoConfetti />` logo após a abertura do `AppShell` principal; adicionar classe `pop-in` ao card de elogio (`:82`): `<div className="choice-card active pop-in">`; e inserir o CTA antes do bloco de CTAs finais (`:128`):

```tsx
      <section className="section">
        <ResumoPracticeCta wordIds={data.words.map((word) => word.id)} />
      </section>
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
Expected: ok

QA manual: finalizar uma conversa com palavras salvas → /resumo mostra confetti e o CTA; clicar → entra no treino com essas palavras.

- [ ] **Step 4: Commit**

```bash
git add components/ResumoPracticeCta.tsx components/ResumoConfetti.tsx app/resumo/page.tsx
git commit -m "feat(juice): resumo pós-conversa com festa e treino das palavras da conversa"
```

---

### Task 7: Festa da meta da conversa + finalizar dali

**Files:**
- Modify: `components/ConversationGoalProgress.tsx`
- Modify: `components/ChatConversation.tsx` (render da meta em `:834`; handler do botão "Finalizar conversa" em `:831`)

**Interfaces:**
- Modifies: `ConversationGoalProgressProps` ganha `onFinish?: () => void` (presente só em sessão ativa).

- [ ] **Step 1: Componente da meta festeja e oferece finalizar**

```tsx
// components/ConversationGoalProgress.tsx
"use client";

import { useEffect, useRef } from "react";
import { PartyPopper } from "lucide-react";
import type { MessageGoalProgress } from "@/lib/learning/chat-contracts";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

type ConversationGoalProgressProps = {
  progress: MessageGoalProgress;
  readOnly?: boolean;
  onFinish?: () => void;
};

export function ConversationGoalProgress({ progress, readOnly = false, onFinish }: ConversationGoalProgressProps) {
  // Inicializa com o estado atual: recarregar uma conversa cuja meta JÁ estava
  // batida não pode disparar festa de novo — só a transição em tempo real.
  const wasReached = useRef(progress.reached);

  useEffect(() => {
    if (progress.enabled && progress.reached && !wasReached.current && !readOnly) {
      wasReached.current = true;
      playSound("goal");
      vibrate("success");
      burstConfetti({ particles: 70 });
    }
  }, [progress.enabled, progress.reached, readOnly]);

  if (!progress.enabled) return null;

  return (
    <section
      aria-label="Meta de mensagens"
      className={`message-goal${progress.reached ? " reached reached-fireworks" : ""}`}
    >
      <div className="message-goal-copy">
        <strong>{progress.reached ? "Meta concluída! 🎉" : `${progress.sent} de ${progress.target} mensagens`}</strong>
        <span>
          {progress.reached
            ? readOnly
              ? "Você alcançou sua meta nesta prática."
              : "Você pode finalizar ou continuar conversando."
            : `Faltam ${progress.remaining}.`}
        </span>
      </div>
      <div
        aria-label={`${progress.percent}% da meta de mensagens`}
        aria-valuemax={progress.target}
        aria-valuemin={0}
        aria-valuenow={Math.min(progress.sent, progress.target)}
        className="message-goal-track"
        role="progressbar"
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      {progress.reached && !readOnly && onFinish ? (
        <button className="outline-button" onClick={onFinish} type="button">
          <PartyPopper aria-hidden="true" /> Finalizar com chave de ouro
        </button>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Ligar o `onFinish` no `ChatConversation`**

Extrair o handler do botão "Finalizar conversa" (`ChatConversation.tsx:831`) para uma função `const requestFinalize = () => setEndDialogOpen(true);` (usar o nome real do state do modal de finalização já existente naquele bloco) e passar ao componente: `<ConversationGoalProgress progress={messageGoal} readOnly={readOnly} onFinish={readOnly ? undefined : requestFinalize} />` (`:834`). O CSS do `.message-goal` já é grid — o botão novo cai na linha de baixo sem quebra.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
Expected: ok

QA manual: conversa com meta de 2 mensagens → na 2ª mensagem: fanfarra curta + confetti + botão "Finalizar com chave de ouro" que abre o modal de finalização; abrir conversa concluída (read-only) → sem festa.

- [ ] **Step 4: Commit**

```bash
git add components/ConversationGoalProgress.tsx components/ChatConversation.tsx
git commit -m "feat(juice): meta da conversa celebrada e finalização a um toque"
```

---

### Task 8: Micro-recompensa por correção no chat

**Files:**
- Modify: `components/ChatConversation.tsx` (state `corrections` em `:81`; render do bloco em `:775-793`)

**Interfaces:**
- Consumes: `playSound`, `vibrate`, classe CSS `.correction-award` (Task 4).

- [ ] **Step 1: Som/vibração quando novas correções chegam**

Adicionar (perto do `useMemo` de `correctionsByMessageId`, `:124-132`):

```ts
  // null = primeira medição (corrigeções já carregadas do banco não tocam som).
  const previousCorrectionsCount = useRef<number | null>(null);
  useEffect(() => {
    if (previousCorrectionsCount.current === null) {
      previousCorrectionsCount.current = corrections.length;
      return;
    }
    if (corrections.length > previousCorrectionsCount.current) {
      playSound("neutral");
      vibrate("tap");
    }
    previousCorrectionsCount.current = corrections.length;
  }, [corrections.length]);
```

- [ ] **Step 2: Badge "+N" no bloco de correção**

No título do `correction-block` (`:775-793`, onde está o rótulo "Correção"), acrescentar o badge por mensagem:

```tsx
                <span className="correction-award" aria-hidden="true">+{messageCorrections.length}</span>
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
Expected: ok

QA manual: enviar uma mensagem com erro → a IA responde com correção → som suave + badge "+1" pulsando sobre o bloco; correções antigas ao reabrir conversa NÃO tocam som (contador parte do valor inicial).

- [ ] **Step 4: Commit**

```bash
git add components/ChatConversation.tsx
git commit -m "feat(juice): cada correção aplicada vira micro-recompensa no chat"
```

---

### Task 9: Toggles de som e vibração no Perfil

**Files:**
- Modify: `components/ProfilePreferences.tsx` (seção de preferências do Perfil)

**Interfaces:**
- Consumes: `isSoundEnabled`/`setSoundEnabled`, `isHapticsEnabled`/`setHapticsEnabled`.

- [ ] **Step 1: Adicionar a seção**

Dentro do formulário de preferências, após o último switch existente (o padrão de markup é o switch de `OnboardingForm.tsx:271-294`), acrescentar:

```tsx
      <div className="switch-row">
        <label htmlFor="sound-enabled">Sons do app</label>
        <input
          checked={soundEnabled}
          id="sound-enabled"
          onChange={(event) => { setSoundEnabled(event.target.checked); setSoundEnabledState(event.target.checked); }}
          type="checkbox"
        />
      </div>
      <div className="switch-row">
        <label htmlFor="haptics-enabled">Vibração</label>
        <input
          checked={hapticsEnabled}
          id="haptics-enabled"
          onChange={(event) => { setHapticsEnabled(event.target.checked); setHapticsEnabledState(event.target.checked); }}
          type="checkbox"
        />
      </div>
```

Com estado local inicializado das funções de leitura:

```ts
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled());
  const [hapticsEnabled, setHapticsEnabledState] = useState(() => isHapticsEnabled());
```

(Se `ProfilePreferences` usar nomes/estrutura de switch diferentes, seguir o padrão local — a exigência é: dois checkboxes persistidos em localStorage, salvamento imediato sem botão.)

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm run build`
Expected: ok

QA: desligar som → vereditos ficam mudos (a vibração segue se ligada); recarregar → preferência persiste.

- [ ] **Step 3: Commit**

```bash
git add components/ProfilePreferences.tsx
git commit -m "feat(juice): preferências de som e vibração no perfil"
```

---

### Task 10: Bump de cache do PWA + verificação de release

**Files:**
- Modify: `public/sw.js:1`

- [ ] **Step 1: Bump**

```js
const CACHE_NAME = "ai-fluency-shell-v15";
```

- [ ] **Step 2: Verificação de release (subset executável local)**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: tudo verde. (O `test:release` completo exige QA env/E2E — rodar antes do deploy conforme ritual do repo.)

- [ ] **Step 3: Commit + push (deploy)**

```bash
git add public/sw.js
git commit -m "chore(pwa): cache shell v15 (juice)"
git push
```

Pós-deploy: instalar/atualizar o PWA no celular e repetir o QA manual das Tasks 5-8 no dispositivo real (vibração só existe lá).

## Critérios de aceite do plano

1. As três telas de fim de sessão (palavras novas, treino, resumo) celebram com animação/som/confetti conforme especificado.
2. Vereditos dos dois treinadores têm feedback sonoro/vibratorial distinto por classe de resposta.
3. Meta da conversa dispara festa única e oferece finalização no lugar.
4. Correção nova no chat dá micro-feedback e badge "+N" sem tocar em correções antigas.
5. Todos os loops novos ("Revisar em cards", CTA do resumo) terminam num treino real com as palavras certas.
6. `prefers-reduced-motion` desliga confetti/animações; sons/vibração têm opt-out persistido.
7. Sem migração de banco; `lint`/`typecheck`/`test:unit`/`build` verdes; `CACHE_NAME` bumpado.
