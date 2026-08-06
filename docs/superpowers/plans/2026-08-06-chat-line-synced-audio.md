# Chat Line-Synced Audio (Karaokê por Mensagem) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No chat, cada mensagem da IA ganha um player de áudio que destaca a frase sendo ouvida (linha a linha, estilo karaokê) e permite pausar, voltar e avançar frase por frase.

**Architecture:** O servidor Kokoro em produção **não** expõe timestamps de palavras (`POST /dev/captioned_speech` responde 404 — verificado em 2026-08-06), então a sincronia é feita por **síntese por frase**: um novo util divide o texto da mensagem em frases, cada frase é sintetizada individualmente via o endpoint existente `POST /api/voice/synthesize` (que já tem cache em disco por texto+ voz, então frases repetidas são grátis), e um novo componente `MessageAudioPlayer` encadeia a reprodução (`audio.onended` → próxima frase) destacando a linha ativa. Voltar/avançar = trocar o índice da frase e tocar o áudio correspondente. O fallback silencioso para `window.speechSynthesis` continua funcionando, também frase a frase (`utterance.onend` → próxima frase).

**Tech Stack:** Next.js App Router, React client components, Vitest (`tests/unit`), HTMLAudioElement + Web Speech API, Kokoro TTS via `/api/voice/synthesize` (sem mudanças no servidor).

## Global Constraints

- Não modificar o servidor Kokoro nem os endpoints `/api/voice/*` — o plano é 100% client-side + um util em `lib/`.
- Não adicionar nenhuma dependência nova ao `package.json`.
- Respeitar o comportamento iOS existente: sempre aguardar `msUntilAudioRouteRestored()` (`lib/learning/speech.ts`) antes de chamar `audio.play()` após uso do microfone.
- Respeitar o fallback silencioso para `speechSynthesis` em falha do Kokoro, com beacon `voice_device_fallback` (padrão atual em `components/VoiceButton.tsx`).
- Respeitar `transcriptEnabled`: quando o transcript está desligado, o texto da IA não é exibido — o player mostra só os controles, nunca as frases.
- `VoiceButton` continua existindo e inalterado em comportamento (usado em flashcards e correções); o novo player vale **apenas** para bolhas de mensagens da IA no chat.
- Apenas um áudio por vez no app: o novo player deve entrar na mesma coordenação de "voz ativa" do `VoiceButton`.
- Testes unitários novos seguem o padrão Vitest em `tests/unit/*.test.ts` com alias `@/` (ver `vitest.config.ts`).
- Comandos de verificação do projeto: `npm run test:unit`, `npm run lint`, `npm run typecheck` (usar os scripts reais do `package.json`).

---

### Task 1: Sentence splitter (`lib/learning/sentences.ts`)

Util puro que divide o texto de uma mensagem em frases tocáveis. Cobre pontuação final (`.`, `!`, `?`, `…`), aspas/fechos depois da pontuação, múltiplos espaços/quebras de linha, e texto sem pontuação final. Limitação conhecida e aceita: abreviações com ponto ("Dr.", "etc.") podem gerar quebras extras — documentado no JSDoc, não tratar.

**Files:**
- Create: `lib/learning/sentences.ts`
- Test: `tests/unit/sentences.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `splitIntoSentences(text: string): string[]` — usada pelo Task 3 (`MessageAudioPlayer`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sentences.test.ts
import { describe, expect, it } from "vitest";
import { splitIntoSentences } from "@/lib/learning/sentences";

describe("splitIntoSentences", () => {
  it("returns empty array for empty/blank text", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   \n  ")).toEqual([]);
  });

  it("keeps a single sentence without trailing punctuation as one line", () => {
    expect(splitIntoSentences("Hello there")).toEqual(["Hello there"]);
  });

  it("splits on period, question mark and exclamation", () => {
    expect(splitIntoSentences("Hi there. How are you? Great!")).toEqual([
      "Hi there.",
      "How are you?",
      "Great!"
    ]);
  });

  it("keeps closing quotes/parens attached to the sentence", () => {
    expect(splitIntoSentences('She said "hello." Then she left.')).toEqual([
      'She said "hello."',
      "Then she left."
    ]);
  });

  it("collapses newlines and extra whitespace between sentences", () => {
    expect(splitIntoSentences("Line one.\n\n   Line two?   Line three!")).toEqual([
      "Line one.",
      "Line two?",
      "Line three!"
    ]);
  });

  it("treats ellipsis as sentence ending", () => {
    expect(splitIntoSentences("Well… I don't know. Maybe.")).toEqual([
      "Well…",
      "I don't know.",
      "Maybe."
    ]);
  });

  it("handles text with no sentence punctuation at all", () => {
    expect(splitIntoSentences("just one long fragment without stops")).toEqual([
      "just one long fragment without stops"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sentences.test.ts`
Expected: FAIL — módulo `@/lib/learning/sentences` não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/learning/sentences.ts
/**
 * Splits message text into speakable sentence lines for the
 * line-synced audio player in the chat.
 *
 * Known limitation (accepted): abbreviations with a period
 * ("Dr.", "etc.") may split into extra lines.
 */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g);
  return (sentences ?? [normalized]).map((sentence) => sentence.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sentences.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/sentences.ts tests/unit/sentences.test.ts
git commit -m "feat: add sentence splitter for line-synced chat audio"
```

---

### Task 2: Extrair helpers de voz compartilhados (`components/voice-shared.ts`)

Hoje `components/VoiceButton.tsx` tem como detalhes privados de módulo: a coordenação de voz ativa (`activeVoice`, linha 20), o dedup de requests (`speechRequests` + `requestSpeech`, linhas 21 e 260-284), o fallback de device (`playDeviceSpeech`, linhas 248-258) e o beacon (`reportDeviceFallback`, linhas 231-246). O novo player precisa de tudo isso. Extrair para um módulo compartilhado e refatorar o `VoiceButton` para consumir — **sem mudar comportamento**.

**Files:**
- Create: `components/voice-shared.ts`
- Modify: `components/VoiceButton.tsx` (imports + 3 trechos; resto inalterado)

**Interfaces:**
- Consumes: nada novo.
- Produces (usadas pelo Task 3):
  - `claimActiveVoice(owner: symbol, stop: () => void): void` — para a voz ativa anterior (se for de outro owner) e registra a nova.
  - `releaseActiveVoice(owner: symbol): void` — limpa o registro se o owner for o atual.
  - `requestSpeech(text: string, languageCode?: string): Promise<string>` — POST `/api/voice/synthesize`, retorna `audioUrl`; dedup em memória (cap 100).
  - `playDeviceSpeech(text: string, languageCode: string | undefined, rate: number, onEnd: () => void): SpeechSynthesisUtterance | null`
  - `reportDeviceFallback(text: string, languageCode: string | undefined): void`

- [ ] **Step 1: Create the shared module**

```ts
// components/voice-shared.ts
"use client";

type ActiveVoice = { owner: symbol; stop: () => void };

let activeVoice: ActiveVoice | null = null;
const speechRequests = new Map<string, Promise<string>>();

/** Para a voz ativa de outro owner (se houver) e registra a nova voz ativa. */
export function claimActiveVoice(owner: symbol, stop: () => void) {
  if (activeVoice?.owner !== owner) activeVoice?.stop();
  activeVoice = { owner, stop };
}

/** Limpa o registro de voz ativa, mas apenas se o owner ainda for o atual. */
export function releaseActiveVoice(owner: symbol) {
  if (activeVoice?.owner === owner) activeVoice = null;
}

export function requestSpeech(text: string, languageCode: string | undefined): Promise<string> {
  const key = `${languageCode ?? ""}\n${text}`;
  const existing = speechRequests.get(key);
  if (existing) return existing;

  const request = fetch("/api/voice/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, languageCode })
  }).then(async (response) => {
    const data = (await response.json()) as { ok?: boolean; audioUrl?: string; error?: string };
    if (!response.ok || !data.ok || !data.audioUrl) throw new Error(data.error ?? "Audio unavailable.");
    return data.audioUrl;
  }).catch((error) => {
    speechRequests.delete(key);
    throw error;
  });

  if (speechRequests.size >= 100) {
    const oldestKey = speechRequests.keys().next().value;
    if (oldestKey) speechRequests.delete(oldestKey);
  }
  speechRequests.set(key, request);
  return request;
}

export function reportDeviceFallback(text: string, languageCode: string | undefined) {
  const body = JSON.stringify({
    event_name: "voice_device_fallback",
    payload: { language: languageCode ?? "", textLength: text.length }
  });
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => undefined);
}

export function playDeviceSpeech(text: string, languageCode: string | undefined, rate: number, onEnd: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = languageCode || "en";
  utterance.rate = rate;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
  return utterance;
}
```

- [ ] **Step 2: Refactor VoiceButton to consume the shared module**

Em `components/VoiceButton.tsx`:

a) Substituir o bloco de imports (linhas 1-5) por:

```tsx
"use client";

import { Loader2, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  playDeviceSpeech,
  releaseActiveVoice,
  reportDeviceFallback,
  requestSpeech
} from "./voice-shared";
```

b) Remover as declarações locais (linhas 20-21):

```tsx
let activeVoice: { owner: symbol; stop: () => void } | null = null;
const speechRequests = new Map<string, Promise<string>>();
```

c) Em `releaseAudio`, trocar a linha `if (activeVoice?.owner === ownerRef.current) activeVoice = null;` por:

```tsx
releaseActiveVoice(ownerRef.current);
```

d) Em `playExisting`, trocar as duas linhas:

```tsx
if (activeVoice?.owner !== ownerRef.current) activeVoice?.stop();
activeVoice = { owner: ownerRef.current, stop: stopForAnotherVoice };
```

por:

```tsx
claimActiveVoice(ownerRef.current, stopForAnotherVoice);
```

e) Remover as funções locais `reportDeviceFallback`, `playDeviceSpeech` e `requestSpeech` (linhas 231-284) — agora importadas.

- [ ] **Step 3: Verify refactor — nothing else changed**

Run: `git diff --stat` → apenas `components/VoiceButton.tsx` modificado e `components/voice-shared.ts` novo.
Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: tudo verde; nenhum teste existente quebra (não há testes de componente; o gate cobre regressões de tipo/lint).

- [ ] **Step 4: Commit**

```bash
git add components/voice-shared.ts components/VoiceButton.tsx
git commit -m "refactor: extract shared voice helpers from VoiceButton"
```

---

### Task 3: `MessageAudioPlayer` — player com destaque linha a linha

Componente client que substitui o `VoiceButton` nas bolhas da IA. Renderiza o texto como linhas de frase (quando `showTranscript`) com a linha ativa destacada, e controles: play/pause, voltar frase, avançar frase.

**Comportamento (contrato):**
- `idle` → play: toca da linha atual (inicial 0) até o fim, encadeando `onended`.
- `playing` → pause: pausa o áudio; resume continua a mesma linha.
- Voltar/avançar **tocando**: pula para a linha anterior/próxima e toca imediatamente.
- Voltar/avançar **pausado/idle**: só move a linha atual (sem tocar); o highlight acompanha.
- Fim da última linha → status `ended`; play reinicia da linha 0.
- Prefetch: ao começar a linha `i`, dispara `requestSpeech` da linha `i+1` (o cache de disco do servidor torna replays grátis).
- Erro de síntese/reprodução → modo fallback: `speechSynthesis` linha a linha (mesmo highlight, mesmo encadeamento via `utterance.onend`), com beacon `voice_device_fallback` uma única vez por ativação do fallback.
- Só um áudio por vez no app: usa `claimActiveVoice`/`releaseActiveVoice` do Task 2 — apertar play em outra bolha ou num `VoiceButton` para este player.

**Files:**
- Create: `components/MessageAudioPlayer.tsx`

**Interfaces:**
- Consumes: `splitIntoSentences` (Task 1); `claimActiveVoice`, `releaseActiveVoice`, `requestSpeech`, `playDeviceSpeech`, `reportDeviceFallback` (Task 2); `msUntilAudioRouteRestored` (`lib/learning/speech.ts`).
- Produces: `<MessageAudioPlayer text languageCode showTranscript preload? />` — usado pelo Task 5.

- [ ] **Step 1: Create the component**

```tsx
// components/MessageAudioPlayer.tsx
"use client";

import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitIntoSentences } from "@/lib/learning/sentences";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  playDeviceSpeech,
  releaseActiveVoice,
  reportDeviceFallback,
  requestSpeech
} from "./voice-shared";

type MessageAudioPlayerProps = {
  text: string;
  languageCode?: string;
  showTranscript: boolean;
  preload?: boolean;
};

type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export function MessageAudioPlayer({ text, languageCode, showTranscript, preload = false }: MessageAudioPlayerProps) {
  const lines = useMemo(() => splitIntoSentences(text), [text]);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [currentLine, setCurrentLine] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef(new Map<number, string>());
  const ownerRef = useRef(Symbol("message-audio-player"));
  const deviceFallbackRef = useRef(false);
  const fallbackReportedRef = useRef(false);
  const generationRef = useRef(0); // invalida callbacks de áudio/utterance antigos

  const releaseAudio = useCallback(() => {
    generationRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    releaseAudio();
    setStatus("idle");
    setCurrentLine(0);
  }, [releaseAudio]);

  useEffect(() => () => {
    releaseAudio();
    releaseActiveVoice(ownerRef.current);
  }, [releaseAudio]);

  const enableDeviceFallback = useCallback(() => {
    if (!deviceFallbackRef.current) {
      deviceFallbackRef.current = true;
      if (!fallbackReportedRef.current) {
        fallbackReportedRef.current = true;
        reportDeviceFallback(text, languageCode);
      }
    }
  }, [languageCode, text]);

  const playLine = useCallback(async (index: number) => {
    if (index < 0 || index >= lines.length) return;
    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    releaseAudio();
    // Captura a geração ANTES do wait do iOS: um stop/unmount durante a
    // espera incrementa a geração e precisa invalidar os callbacks deste play.
    const generation = generationRef.current;
    setCurrentLine(index);
    setStatus("loading");

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante
    // antes de tocar após uso do microfone.
    const routeRestoreWait = msUntilAudioRouteRestored();
    if (routeRestoreWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, routeRestoreWait));
    }

    if (deviceFallbackRef.current) {
      playDeviceLine(index, generation);
      return;
    }

    try {
      let audioUrl = audioUrlsRef.current.get(index);
      if (!audioUrl) {
        audioUrl = await requestSpeech(lines[index], languageCode);
        audioUrlsRef.current.set(index, audioUrl);
      }
      if (generationRef.current !== generation) return; // usuário pulou de linha durante o fetch

      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        const next = index + 1;
        if (next < lines.length) void playLine(next);
        else setStatus("ended");
      };
      audio.onerror = () => {
        if (audioRef.current !== audio) return;
        enableDeviceFallback();
        playDeviceLine(index, generationRef.current);
      };
      await audio.play();
      setStatus("playing");

      // Prefetch da próxima linha (o cache em disco do servidor torna replays grátis).
      const next = index + 1;
      if (next < lines.length && !audioUrlsRef.current.has(next)) {
        requestSpeech(lines[next], languageCode)
          .then((url) => audioUrlsRef.current.set(next, url))
          .catch(() => undefined);
      }
    } catch {
      if (generationRef.current !== generation) return;
      enableDeviceFallback();
      playDeviceLine(index, generationRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableDeviceFallback, languageCode, lines, releaseAudio, stopForAnotherVoice]);

  const playDeviceLine = useCallback((index: number, generation: number) => {
    const utterance = playDeviceSpeech(lines[index], languageCode, 1, () => {
      if (generationRef.current !== generation) return;
      const next = index + 1;
      if (next < lines.length) playDeviceLine(next, generation);
      else setStatus("ended");
    });
    if (!utterance) {
      setStatus("error");
      return;
    }
    setStatus("playing");
  }, [languageCode, lines]);

  async function togglePlayback() {
    if (!lines.length) return;

    if (status === "playing") {
      if (deviceFallbackRef.current) window.speechSynthesis?.pause();
      else audioRef.current?.pause();
      setStatus("paused");
      return;
    }
    if (status === "paused") {
      if (deviceFallbackRef.current) {
        window.speechSynthesis?.resume();
        setStatus("playing");
      } else if (audioRef.current) {
        try {
          await audioRef.current.play();
          setStatus("playing");
        } catch {
          void playLine(currentLine);
        }
      } else {
        await playLine(currentLine);
      }
      return;
    }
    // idle | ended | error → começa (ou recomeça) da linha atual/0
    await playLine(status === "ended" ? 0 : currentLine);
  }

  function skipLine(delta: number) {
    const target = Math.min(Math.max(currentLine + delta, 0), lines.length - 1);
    if (target === currentLine && status !== "ended") return;
    // No fallback (speechSynthesis) não é possível redirecionar uma utterance
    // pausada para outra linha, então o skip pausado toca a linha alvo na hora.
    if (status === "playing" || status === "paused" && audioRef.current === null && deviceFallbackRef.current) {
      void playLine(target);
      return;
    }
    // idle/paused/ended: apenas move o cursor, sem tocar
    releaseAudio();
    setCurrentLine(target);
    if (status === "ended") setStatus("idle");
  }

  // Preload da primeira linha (mesma ideia do preload do VoiceButton: só na última mensagem)
  useEffect(() => {
    if (!preload || !lines.length || audioUrlsRef.current.has(0)) return;
    requestSpeech(lines[0], languageCode)
      .then((url) => audioUrlsRef.current.set(0, url))
      .catch(() => undefined);
  }, [languageCode, lines, preload]);

  const PlayIcon = status === "loading" ? Loader2 : status === "playing" ? Pause : status === "ended" ? RotateCcw : Play;
  const playLabel =
    status === "loading" ? "Preparando áudio" :
    status === "playing" ? "Pausar áudio" :
    status === "paused" ? "Continuar áudio" :
    status === "ended" ? "Ouvir novamente" :
    status === "error" ? "Voz indisponível. Tentar novamente" :
    "Ouvir mensagem";

  return (
    <div className="message-audio-player">
      {showTranscript ? (
        <div className="chat-lines">
          {lines.map((line, index) => (
            <span
              className={index === currentLine && (status === "playing" || status === "paused" || status === "loading") ? "chat-line active" : "chat-line"}
              key={index}
            >
              {line}
            </span>
          ))}
        </div>
      ) : null}
      <div className="line-player-controls">
        <button
          aria-label="Voltar uma frase"
          className="voice-icon-button"
          disabled={lines.length < 2 || status === "loading"}
          onClick={() => skipLine(-1)}
          type="button"
        >
          <SkipBack />
        </button>
        <button aria-label={playLabel} className="voice-icon-button" onClick={togglePlayback} title={playLabel} type="button">
          <PlayIcon className={status === "loading" ? "spin" : undefined} />
        </button>
        <button
          aria-label="Avançar uma frase"
          className="voice-icon-button"
          disabled={lines.length < 2 || status === "loading"}
          onClick={() => skipLine(1)}
          type="button"
        >
          <SkipForward />
        </button>
      </div>
    </div>
  );
}
```

> Nota para o implementador: `playLine` é referenciada por `audio.onended`/`playDeviceLine` antes da declaração de `playDeviceLine`; manter a ordem `playLine` → `playDeviceLine` com `function`-hoisting ou converter `playDeviceLine` para `function` declarativa dentro do componente se o linter reclamar de uso antes da definição. Ajuste mínimo permitido; o comportamento do contrato acima é o que vale.

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint && npm run typecheck`
Expected: verde (o componente ainda não é usado em lugar nenhum — sem testes de componente no projeto; a verificação de comportamento é no Task 5).

- [ ] **Step 3: Commit**

```bash
git add components/MessageAudioPlayer.tsx
git commit -m "feat: add line-synced message audio player component"
```

---

### Task 4: CSS — linhas e controles do player

**Files:**
- Modify: `app/globals.css` (inserir após o bloco `.audio-pill`, ~linha 1361)

- [ ] **Step 1: Add styles**

```css
/* Line-synced chat audio player */
.chat-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-line {
  border-radius: 6px;
  padding: 1px 6px;
  margin: 0 -6px;
  transition: background-color 160ms ease;
}

.chat-line.active {
  background: var(--section-soft);
  font-weight: 600;
}

.line-player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.line-player-controls .voice-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}
```

> Se `--section-soft` não existir como token no tema claro (ela é usada em `.bubble.user`, linha 2531), verificar no `:root` de `globals.css` e usar o token de superfície equivalente já existente; não inventar cor nova.

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "style: add line player and chat line highlight styles"
```

---

### Task 5: Ligar o player nas bolhas da IA no chat

**Files:**
- Modify: `components/ChatConversation.tsx:635-652` (bloco da bolha `assistant`)

**Interfaces:**
- Consumes: `<MessageAudioPlayer text languageCode showTranscript preload />` (Task 3).

- [ ] **Step 1: Replace the assistant bubble body**

Em `components/ChatConversation.tsx`, substituir o conteúdo da bolha da IA (linhas 638-651):

```tsx
<div className="bubble ai">
  {transcriptEnabled ? message.fields.text : "Resposta da IA disponível em áudio."}
  {transcriptEnabled ? <div className="message-actions">
    <CopyButton compact label="Copiar mensagem da IA" text={message.fields.text} />
    <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
  </div> : null}
  {audioEnabled ? (
    <VoiceButton
      languageCode={speechLanguage}
      label="Ouvir mensagem"
      preload={!readOnly && message.id === latestAssistantMessageId}
      text={message.fields.text}
    />
  ) : null}
</div>
```

por:

```tsx
<div className="bubble ai">
  {audioEnabled ? (
    <MessageAudioPlayer
      languageCode={speechLanguage}
      preload={!readOnly && message.id === latestAssistantMessageId}
      showTranscript={transcriptEnabled}
      text={message.fields.text}
    />
  ) : transcriptEnabled ? message.fields.text : "Resposta da IA disponível em áudio."}
  {transcriptEnabled ? <div className="message-actions">
    <CopyButton compact label="Copiar mensagem da IA" text={message.fields.text} />
    <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
  </div> : null}
</div>
```

E adicionar o import no topo do arquivo:

```tsx
import { MessageAudioPlayer } from "./MessageAudioPlayer";
```

> Nota: com `audioEnabled` ligado, quem renderiza o texto passa a ser o `MessageAudioPlayer` (linha a linha); com ele desligado, o comportamento anterior se mantém. O `VoiceButton` continua sendo usado nas correções (linha 679) — não tocar.

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: verde.

- [ ] **Step 3: Manual QA (dev server + Kokoro configurado)**

Run: `npm run dev`, abrir `/chat` numa conversa ativa e verificar:

1. Play numa bolha da IA → a primeira frase é destacada; o destaque avança frase a frase até o fim.
2. Pause no meio → destaque congela na frase atual; resume continua de onde parou.
3. Avançar/voltar tocando → pula imediatamente para a frase seguinte/anterior e toca.
4. Avançar/voltar pausado → só move o destaque, sem tocar.
5. Play numa segunda bolha → a primeira para e reseta.
6. Play no player e depois num `VoiceButton` de correção → o player para.
7. Recarregar a página e tocar de novo → segunda reprodução é instantânea (cache em disco do servidor).
8. (Simular falha: desligar o Kokoro) → fallback para voz do dispositivo ainda destaca frase a frase.

- [ ] **Step 4: Commit**

```bash
git add components/ChatConversation.tsx
git commit -m "feat: line-synced audio player in chat assistant messages"
```

---

## Self-Review (concluído pelo autor do plano)

- **Spec coverage:** destaque linha a linha sincronizado (Tasks 1, 3, 4, 5) ✔; pausar (Task 3, `togglePlayback`) ✔; voltar/avançar linha a linha (Task 3, `skipLine`) ✔; escopo por mensagem, conforme decidido com o usuário ✔.
- **Placeholder scan:** a única nota flexível é o ajuste de hoisting em `playLine`/`playDeviceLine` (Task 3) e o token de cor (Task 4) — ambos com instrução concreta de resolução, sem comportamento em aberto.
- **Type consistency:** `splitIntoSentences(text: string): string[]` (Task 1) = assinatura usada no Task 3 ✔; `claimActiveVoice/releaseActiveVoice/requestSpeech/playDeviceSpeech/reportDeviceFallback` (Task 2) = nomes importados nos Tasks 2 e 3 ✔; props `text/languageCode/showTranscript/preload` (Task 3) = uso no Task 5 ✔.
- **Risco conhecido:** quebra de prosódia entre frases (cada frase é um áudio separado) — mitigado pelo prefetch da linha seguinte; se a UX se mostrar ruim, o próximo passo seria atualizar a imagem do Kokoro no VPS para uma versão com `/dev/captioned_speech` e migrar para timestamps de palavras (fora do escopo deste plano).
