# Plano de Implementação: Loading animado, volume TTS consistente no iOS e STT inteligente

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as três melhorias da spec `docs/superpowers/specs/2026-08-02-loading-audio-stt-design.md`: (1) telas de carregamento com animação contínua, (2) volume de TTS consistente no iOS após uso do microfone, (3) correção de pontuação/capitalização do STT via LLM.

**Architecture:** STT: simplificar o join local de segmentos e adicionar uma rota `/api/speech/cleanup` que passa o transcript bruto pelo provider de IA já configurado (`lib/ai/client.ts`), com guarda anti-reescrita no servidor e fallback transparente para o texto bruto. Áudio: liberar explicitamente a sessão de áudio do iOS ao parar o `SpeechRecognition` (abort + handlers nulos), sinalizar o momento da liberação via módulo compartilhado em `lib/learning/speech.ts`, e atrasar o próximo `audio.play()` até ~350ms; telemetria do fallback silencioso para `speechSynthesis` via `/api/events`. Loading: corrigir o conflito de `.loading-mark` no CSS (a versão vencedora usa animação one-shot `bounce-in`) para entrada + loop contínuo, e escalonar o shimmer dos skeletons — tudo em `app/globals.css`, sem mudança de markup.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Vitest (`npm run test:unit`), CSS puro em `app/globals.css` (sem Tailwind), Web Speech API (STT e fallback TTS), Kokoro TTS via `/api/voice/*`.

## Global Constraints

- Strings visíveis ao usuário em **português brasileiro**; código e comentários seguem o estilo do arquivo editado.
- Não adicionar nenhuma dependência nova ao `package.json`.
- Testes unitários com Vitest; `server-only` é stubado em `vitest.config.ts` (alias para `tests/stubs/server-only.ts`) — libs server-only podem ser importadas em testes normalmente.
- Comandos de verificação por task: `npx vitest run <arquivo>` para testes, `npm run typecheck` quando houver mudança de tipos, `npm run lint` ao final de cada task.
- O app **não usa Tailwind**; todo CSS vive em `app/globals.css`.
- `prefers-reduced-motion` (globals.css:1852-1861) neutraliza animações globalmente — nenhuma animação nova precisa de tratamento especial.
- Node >= 20.19 e < 23.

---

### Task 1: `joinSpeechSegments` sem vírgula automática e com lowercase heurístico

**Files:**
- Modify: `lib/learning/speech.ts:34-46`
- Test: `tests/unit/speech.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `joinSpeechSegments(segments: string[], languageCode: string | undefined): string` — mesma assinatura; novo comportamento: junta segmentos com espaço (sem inserir `,`), rebaixa a primeira letra de segmentos cujo anterior não termina em pontuação, e aplica `punctuateSpeechSentence` no final.

- [ ] **Step 1: Substituir o teste que codifica a vírgula automática por testes do novo comportamento**

Em `tests/unit/speech.test.ts`, substituir o teste `"turns recognition pauses into readable punctuation"` (linhas 36-40) por:

```ts
  it("joins recognition pauses without inserting commas", () => {
    expect(joinSpeechSegments(["I went to the market", "then I met Ana"], "en")).toBe(
      "I went to the market then I met Ana."
    );
  });

  it("lowercases spurious capitals after a pause inside a sentence", () => {
    expect(joinSpeechSegments(["how was your", "Trip"], "en")).toBe("how was your trip?");
  });

  it("keeps the capital when the previous segment ended a sentence", () => {
    expect(joinSpeechSegments(["I went home.", "Then I slept"], "en")).toBe("I went home. Then I slept.");
  });
```

- [ ] **Step 2: Rodar os testes e verificar que falham**

Run: `npx vitest run tests/unit/speech.test.ts`
Expected: FAIL nos dois primeiros testes novos (o join atual insere `,` e não altera case).

- [ ] **Step 3: Implementar o novo join em `lib/learning/speech.ts`**

Substituir a função `joinSpeechSegments` (linhas 34-46) por:

```ts
export function joinSpeechSegments(segments: string[], languageCode: string | undefined) {
  const cleanSegments = segments.map((segment) => normalizeSpeechSpacing(segment)).filter(Boolean);
  if (cleanSegments.length === 0) return "";

  const joined = cleanSegments
    .map((segment, index) => {
      if (index === 0) return segment;
      const previous = cleanSegments[index - 1];
      if (/[.!?…]$/.test(previous)) return segment;
      return lowercaseFirstLetter(segment);
    })
    .join(" ");

  return punctuateSpeechSentence(joined, languageCode);
}

function lowercaseFirstLetter(value: string) {
  const first = value[0];
  if (!first) return value;
  const lowered = first.toLocaleLowerCase();
  return first === lowered ? value : `${lowered}${value.slice(1)}`;
}
```

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run tests/unit/speech.test.ts`
Expected: PASS (5 testes no describe, incluindo os de `punctuateSpeechSentence` inalterados).

- [ ] **Step 5: Commit**

```bash
git add lib/learning/speech.ts tests/unit/speech.test.ts
git commit -m "fix(stt): join de segmentos sem vírgula automática e com lowercase de maiúsculas espúrias"
```

---

### Task 2: `lib/learning/speech-cleanup.ts` — correção via LLM com guarda anti-reescrita

**Files:**
- Create: `lib/learning/speech-cleanup.ts`
- Test: `tests/unit/speech-cleanup.test.ts`

**Interfaces:**
- Consumes: `createChatCompletion(messages, options)` de `lib/ai/client.ts` (suporta `temperature`, `maxTokens`, `timeoutMs`, `disableThinking`).
- Produces: `cleanupSpeechTranscript(rawText: string, languageCode: string | undefined): Promise<string>` — retorna o texto corrigido, ou o bruto se o LLM divergir/falhar. `divergesFromRaw(raw: string, cleaned: string): boolean` — exportada para teste.

- [ ] **Step 1: Escrever o teste com o client de IA mockado**

Criar `tests/unit/speech-cleanup.test.ts` (seguindo o padrão de `tests/unit/chat-structured-turn.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createChatCompletion = vi.fn();
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

import { cleanupSpeechTranscript, divergesFromRaw } from "../../lib/learning/speech-cleanup";

beforeEach(() => {
  createChatCompletion.mockReset();
});

describe("cleanupSpeechTranscript", () => {
  it("returns the corrected text when the LLM only fixes punctuation and case", async () => {
    createChatCompletion.mockResolvedValue({ content: "I went to the market then I met Ana." });
    await expect(cleanupSpeechTranscript("I went to the market, Then I met Ana.", "en")).resolves.toBe(
      "I went to the market then I met Ana."
    );
  });

  it("returns the raw text when the LLM rewrites the sentence", async () => {
    createChatCompletion.mockResolvedValue({ content: "Yesterday I went shopping at the market and saw Ana." });
    const raw = "I went to the market, Then I met Ana.";
    await expect(cleanupSpeechTranscript(raw, "en")).resolves.toBe(raw);
  });

  it("returns the raw text when the LLM drops or adds words", async () => {
    createChatCompletion.mockResolvedValue({ content: "I went to the market." });
    const raw = "I went to the market, Then I met Ana.";
    await expect(cleanupSpeechTranscript(raw, "en")).resolves.toBe(raw);
  });

  it("returns the raw text unchanged when it is empty", async () => {
    await expect(cleanupSpeechTranscript("   ", "en")).resolves.toBe("");
    expect(createChatCompletion).not.toHaveBeenCalled();
  });
});

describe("divergesFromRaw", () => {
  it("ignores case, accents and punctuation when comparing", () => {
    expect(divergesFromRaw("Voce foi, Para a praia", "Você foi para a praia.")).toBe(false);
  });

  it("flags word changes as divergence", () => {
    expect(divergesFromRaw("I like dogs", "I like cats")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `npx vitest run tests/unit/speech-cleanup.test.ts`
Expected: FAIL com erro de módulo não encontrado (`../../lib/learning/speech-cleanup`).

- [ ] **Step 3: Implementar `lib/learning/speech-cleanup.ts`**

```ts
import "server-only";
import { createChatCompletion } from "@/lib/ai/client";

const cleanupLanguageNames: Record<string, string> = {
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  it: "italiano"
};

export async function cleanupSpeechTranscript(rawText: string, languageCode: string | undefined): Promise<string> {
  const raw = rawText.trim();
  if (!raw) return "";

  const ai = await createChatCompletion([
    {
      role: "system",
      content: [
        "Você corrige pontuação e capitalização de texto produzido por reconhecimento de voz.",
        "Regras obrigatórias:",
        "- NÃO adicione, remova, substitua ou reordene palavras.",
        "- Pausas na fala NÃO são vírgulas: remova vírgulas sem função gramatical.",
        "- Corrija letras maiúsculas indevidas no meio de frases e preserve/restore maiúsculas de nomes próprios.",
        "- Divida o texto em frases terminadas com . ! ou ? quando o sentido indicar.",
        "- Retorne SOMENTE o texto corrigido, sem comentários nem aspas."
      ].join("\n")
    },
    {
      role: "user",
      content: `Idioma do texto: ${cleanupLanguageNames[languageCode?.toLowerCase() ?? ""] ?? "inglês"}\nTexto ditado:\n${raw}`
    }
  ], { temperature: 0, maxTokens: Math.max(120, raw.length * 2), timeoutMs: 3000, disableThinking: true });

  const cleaned = ai.content.trim();
  if (!cleaned || divergesFromRaw(raw, cleaned)) return raw;
  return cleaned;
}

export function divergesFromRaw(raw: string, cleaned: string) {
  const rawWords = wordList(raw);
  const cleanedWords = wordList(cleaned);
  if (Math.abs(rawWords.length - cleanedWords.length) > 1) return true;
  const comparable = Math.min(rawWords.length, cleanedWords.length);
  const matches = rawWords.slice(0, comparable).filter((word, index) => word === cleanedWords[index]).length;
  return matches < comparable * 0.8;
}

function wordList(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
```

Atenção: a regex de diacríticos acima deve ser escrita com escapes unicode — `/[\u0300-\u036f]/g` — exatamente como em `lib/learning/speech.ts:62`, para não depender de caracteres combining literais no arquivo.

- [ ] **Step 4: Rodar o teste e verificar que passa**

Run: `npx vitest run tests/unit/speech-cleanup.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add lib/learning/speech-cleanup.ts tests/unit/speech-cleanup.test.ts
git commit -m "feat(stt): cleanup de transcript via LLM com guarda anti-reescrita"
```

---

### Task 3: Rota `POST /api/speech/cleanup`

**Files:**
- Create: `app/api/speech/cleanup/route.ts`

**Interfaces:**
- Consumes: `cleanupSpeechTranscript` da Task 2; `jsonOk` de `lib/api/responses` (padrão de `app/api/explain-selection/route.ts`).
- Produces: endpoint que recebe `{ text?: string; language?: string }` e responde `{ ok: true, text: string, cleaned: boolean }`. Nunca retorna erro por falha de IA — em qualquer exceção devolve o texto bruto com `cleaned: false`. Limite de entrada: 2000 caracteres.

- [ ] **Step 1: Criar a rota**

```ts
import { jsonOk } from "@/lib/api/responses";
import { cleanupSpeechTranscript } from "@/lib/learning/speech-cleanup";

const MAX_TRANSCRIPT_LENGTH = 2000;

export async function POST(request: Request) {
  const body = await request.json() as { text?: string; language?: string };
  const raw = (body.text ?? "").trim();
  if (!raw || raw.length > MAX_TRANSCRIPT_LENGTH) {
    return jsonOk({ ok: true, text: raw, cleaned: false });
  }
  try {
    const cleaned = await cleanupSpeechTranscript(raw, body.language);
    return jsonOk({ ok: true, text: cleaned, cleaned: cleaned !== raw });
  } catch {
    // Cleanup é best-effort: em qualquer falha de IA o cliente fica com o texto bruto.
    return jsonOk({ ok: true, text: raw, cleaned: false });
  }
}
```

- [ ] **Step 2: Verificar typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros (conferir assinatura de `jsonOk` em `lib/api/responses.ts` — padrão `jsonOk(data, init?)` conforme `app/api/events/route.ts:15`).

- [ ] **Step 3: Commit**

```bash
git add app/api/speech/cleanup/route.ts
git commit -m "feat(stt): rota /api/speech/cleanup com fallback para texto bruto"
```

---

### Task 4: Chat — polir o texto ditado após o fim da fala

**Files:**
- Modify: `components/ChatConversation.tsx`

**Interfaces:**
- Consumes: `POST /api/speech/cleanup` da Task 3 (`{ text, language }` → `{ ok, text, cleaned }`); `mergeSpeechText(existing, transcript)` já existente em `components/ChatConversation.tsx:677`.
- Produces: estado `isPolishingSpeech: boolean` e função interna `polishSpeechTranscript(baseText: string, rawTranscript: string): Promise<void>`.

- [ ] **Step 1: Adicionar estado e ref de controle**

Em `components/ChatConversation.tsx`, junto aos demais estados (após linha 91, `failedMessage`), adicionar:

```ts
  const [isPolishingSpeech, setIsPolishingSpeech] = useState(false);
```

E junto aos refs (após linha 98, `recognitionRestartTimerRef`):

```ts
  const speechPolishRef = useRef<{ base: string; raw: string } | null>(null);
```

- [ ] **Step 2: Adicionar a função de polimento**

Após a função `toggleNativeSpeechRecognition` (termina na linha 416), adicionar:

```ts
  async function polishSpeechTranscript(baseText: string, rawTranscript: string) {
    speechPolishRef.current = { base: baseText, raw: rawTranscript };
    setIsPolishingSpeech(true);
    try {
      const response = await fetch("/api/speech/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawTranscript, language: speechLanguage })
      });
      const data = await response.json() as { ok?: boolean; text?: string; cleaned?: boolean };
      const pending = speechPolishRef.current;
      if (!pending || pending.raw !== rawTranscript) return;
      if (!response.ok || !data.ok || !data.cleaned || !data.text) return;
      const polishedText = data.text;
      setText((current) => {
        // Só substitui se o usuário não editou o campo depois do ditado.
        if (current.trim() !== mergeSpeechText(pending.base, pending.raw).trim()) return current;
        return mergeSpeechText(pending.base, polishedText);
      });
    } catch {
      // Cleanup é best-effort; o texto bruto já está no input.
    } finally {
      speechPolishRef.current = null;
      setIsPolishingSpeech(false);
    }
  }
```

- [ ] **Step 3: Acionar o polimento no `onend` somente quando o ditado termina de vez**

Em `recognition.onend` (linhas 370-406): no branch final `if (!listeningDesiredRef.current)` (linhas 387-391), antes de `setIsListening(false)`, adicionar:

```ts
      if (completedTranscript) void polishSpeechTranscript(recognitionStartTextRef.current, completedTranscript);
```

O branch fica assim:

```ts
      if (!listeningDesiredRef.current) {
        if (completedTranscript) void polishSpeechTranscript(recognitionStartTextRef.current, completedTranscript);
        setIsListening(false);
        recognitionRef.current = null;
        return;
      }
```

Importante: não chamar no caminho de restart (o usuário ainda está falando — o polish concorreria com o próximo segmento).

- [ ] **Step 4: Cancelar o polimento pendente ao enviar a mensagem**

Em `sendMessage` (linha 136), logo após `if (!cleanText) return;` (linha 139), adicionar:

```ts
    speechPolishRef.current = null;
    setIsPolishingSpeech(false);
```

- [ ] **Step 5: Indicador visual sutil no status do reconhecimento**

No parágrafo `speech-status` (linhas 633-641), ajustar o conteúdo para:

```tsx
            {speechSupport === "unsupported"
              ? "Reconhecimento de voz indisponível neste navegador. A digitação continua disponível."
              : isListening
                ? `Ouvindo em ${speechLanguageName(speechLanguage)}. Pressione o microfone novamente para parar.`
                : isPolishingSpeech
                  ? "Ajustando o texto ditado..."
                  : `Reconhecimento de voz: ${speechLanguageName(speechLanguage)}.`}
```

- [ ] **Step 6: Typecheck, lint e testes existentes**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/speech.test.ts`
Expected: sem erros; testes passam (o componente não tem teste de unidade — cobertura manual no passo seguinte).

- [ ] **Step 7: Verificação manual no dev server**

Run: `npm run dev`, abrir o chat no navegador, ditar uma frase com pausa longa no meio.
Expected: o texto bruto aparece imediatamente; ~1s depois é substituído pela versão sem vírgula espúria e sem maiúscula indevida; o status mostra "Ajustando o texto ditado..." durante a espera. Editar o campo durante o polish preserva a edição do usuário.

- [ ] **Step 8: Commit**

```bash
git add components/ChatConversation.tsx
git commit -m "feat(chat): polimento do texto ditado via /api/speech/cleanup após o fim da fala"
```

---

### Task 5: Liberação da sessão de áudio do iOS + sinal `markMicReleased`

**Files:**
- Modify: `lib/learning/speech.ts` (adicionar ao final do arquivo)
- Modify: `components/ChatConversation.tsx`
- Test: `tests/unit/speech.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `markMicReleased(): void` e `msUntilAudioRouteRestored(now?: number): number` em `lib/learning/speech.ts` — a Task 6 (VoiceButton) importa `msUntilAudioRouteRestored`. `AUDIO_ROUTE_RESTORE_MS = 350` (não exportado).

- [ ] **Step 1: Escrever os testes do sinal de liberação do microfone**

Em `tests/unit/speech.test.ts`, atualizar o import para incluir as novas funções:

```ts
import {
  joinSpeechSegments,
  markMicReleased,
  msUntilAudioRouteRestored,
  punctuateSpeechSentence,
  speechLanguageName,
  speechLocale,
  speechRecognitionErrorMessage
} from "../../lib/learning/speech";
```

E adicionar ao final do `describe` (após o teste de capitals da Task 1):

```ts
  it("reports the remaining wait after the mic is released", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      markMicReleased();
      expect(msUntilAudioRouteRestored()).toBe(350);
      vi.setSystemTime(1_000_100);
      expect(msUntilAudioRouteRestored()).toBe(250);
      vi.setSystemTime(1_000_400);
      expect(msUntilAudioRouteRestored()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
```

Adicionar `vi` ao import do vitest na linha 1: `import { describe, expect, it, vi } from "vitest";`.

- [ ] **Step 2: Rodar e verificar que falha**

Run: `npx vitest run tests/unit/speech.test.ts`
Expected: FAIL — `markMicReleased`/`msUntilAudioRouteRestored` não existem.

- [ ] **Step 3: Implementar o sinal em `lib/learning/speech.ts`**

Adicionar ao final do arquivo:

```ts
const AUDIO_ROUTE_RESTORE_MS = 350;

let micReleasedAt = 0;

export function markMicReleased() {
  micReleasedAt = Date.now();
}

export function msUntilAudioRouteRestored(now = Date.now()) {
  return Math.max(0, AUDIO_ROUTE_RESTORE_MS - (now - micReleasedAt));
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `npx vitest run tests/unit/speech.test.ts`
Expected: PASS.

- [ ] **Step 5: Liberar a sessão de áudio no chat ao parar o reconhecimento**

Em `components/ChatConversation.tsx`:

a) Atualizar o import da linha 17:

```ts
import { joinSpeechSegments, markMicReleased, speechLanguageName, speechLocale, speechRecognitionErrorMessage } from "@/lib/learning/speech";
```

b) Adicionar a função `finishRecognitionSession` logo antes de `toggleNativeSpeechRecognition` (linha 311):

```ts
  function finishRecognitionSession() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // No iOS, nullificar os handlers e abortar libera a AVAudioSession de gravação,
    // restaurando a rota/volume do alto-falante para o próximo TTS.
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognitionRef.current = null;
    markMicReleased();
  }
```

c) No `recognition.onend` (linhas 370-406), substituir os dois branches de término:

O branch de suppress (linhas 371-378) fica:

```ts
      if (suppressSpeechCommitRef.current) {
        suppressSpeechCommitRef.current = false;
        speechFinalSegmentsRef.current = [];
        speechInterimRef.current = "";
        finishRecognitionSession();
        setIsListening(false);
        return;
      }
```

O branch final (linhas 387-391, já com o polish da Task 4) fica:

```ts
      if (!listeningDesiredRef.current) {
        if (completedTranscript) void polishSpeechTranscript(recognitionStartTextRef.current, completedTranscript);
        finishRecognitionSession();
        setIsListening(false);
        return;
      }
```

Nota: no caminho de restart (usuário ainda falando) nada muda — a sessão continua ativa intencionalmente.

d) No cleanup do `useEffect` de montagem (linhas 115-126), adicionar `markMicReleased();` após `recognitionRef.current = null;`:

```ts
    return () => {
      listeningDesiredRef.current = false;
      if (recognitionRestartTimerRef.current) clearTimeout(recognitionRestartTimerRef.current);
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
      recognitionRef.current = null;
      markMicReleased();
    };
```

- [ ] **Step 6: Typecheck, lint e testes**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/speech.test.ts`
Expected: sem erros; testes passam.

- [ ] **Step 7: Commit**

```bash
git add lib/learning/speech.ts tests/unit/speech.test.ts components/ChatConversation.tsx
git commit -m "fix(audio): liberar AVAudioSession ao parar o STT e sinalizar markMicReleased"
```

---

### Task 6: VoiceButton — delay pós-mic e telemetria do fallback silencioso

**Files:**
- Modify: `components/VoiceButton.tsx`

**Interfaces:**
- Consumes: `msUntilAudioRouteRestored()` da Task 5; `POST /api/events` (`app/api/events/route.ts`) que aceita `{ event_name, payload }`.
- Produces: nada exportado.

- [ ] **Step 1: Aguardar a rota de áudio do iOS antes de tocar**

Em `components/VoiceButton.tsx`:

a) Adicionar o import (após linha 4):

```ts
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
```

b) Em `playExisting` (linhas 70-82), adicionar o aguardo antes de `await audio.play()`:

```ts
  const playExisting = useCallback(async (audio: HTMLAudioElement) => {
    if (activeVoice?.owner !== ownerRef.current) activeVoice?.stop();
    activeVoice = { owner: ownerRef.current, stop: stopForAnotherVoice };
    audio.playbackRate = playbackRate;
    // iOS: se o microfone acabou de ser liberado, aguarda a AVAudioSession
    // restaurar a rota do alto-falante antes de tocar.
    const routeRestoreWait = msUntilAudioRouteRestored();
    if (routeRestoreWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, routeRestoreWait));
    }
    try {
      await audio.play();
      setStatus("playing");
      onPlayback?.({ replay: audio.currentTime > 0, slow: playbackRate < 1, deviceFallback: false });
    } catch {
      // Another failure handler may have already consumed this audio element.
      if (audioRef.current === audio) startDeviceFallback();
    }
  }, [onPlayback, playbackRate, startDeviceFallback, stopForAnotherVoice]);
```

- [ ] **Step 2: Telemetria do fallback para a voz do sistema**

Em `components/VoiceButton.tsx`:

a) Adicionar a função `reportDeviceFallback` junto às funções utilitárias do final do arquivo (antes de `playDeviceSpeech`, linha 181):

```ts
function reportDeviceFallback(text: string, languageCode: string | undefined) {
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
```

b) Em `startDeviceFallback` (linhas 59-68), registrar o evento como primeira ação:

```ts
  const startDeviceFallback = useCallback(() => {
    reportDeviceFallback(text, languageCode);
    releaseAudio();
    if (!playDeviceSpeech(text, languageCode, playbackRate, () => setStatus("ended"))) {
      setStatus("error");
      onAudioFailure?.();
      return;
    }
    setStatus("playing");
    onPlayback?.({ replay: false, slow: playbackRate < 1, deviceFallback: true });
  }, [languageCode, onAudioFailure, onPlayback, playbackRate, releaseAudio, text]);
```

- [ ] **Step 3: Typecheck, lint e testes**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: sem erros; suíte completa passa.

- [ ] **Step 4: Verificação manual no iPhone (se disponível)**

Run: `npm run dev` acessível na rede local, abrir o chat no Safari do iPhone: ditar uma mensagem (STT), enviar, tocar o áudio da resposta da IA em sequência algumas vezes.
Expected: volume consistente pelo alto-falante em todas as reproduções. (Se não houver iPhone disponível na execução, registrar essa verificação como pendência para o usuário.)

- [ ] **Step 5: Commit**

```bash
git add components/VoiceButton.tsx
git commit -m "fix(audio): delay pós-mic no TTS e telemetria do fallback de voz do sistema"
```

---

### Task 7: Loading de rota com animação contínua

**Files:**
- Modify: `app/globals.css` (bloco linhas 1050-1057, keyframes após linha 2037, bloco linhas 2134-2143)

**Interfaces:**
- Consumes: nada (CSS puro; markup de `app/loading.tsx` e `components/Skeleton.tsx` não muda).
- Produces: keyframe `mark-float`; `.loading-mark` com animação de entrada + loop; stagger de `.skeleton` dentro de `.screen-skeleton`.

- [ ] **Step 1: Remover a definição antiga de `.loading-mark` (ring spinner)**

Em `app/globals.css`, remover o bloco das linhas 1050-1057:

```css
.loading-mark {
  width: 48px;
  height: 48px;
  border: 5px solid var(--primary-soft);
  border-top-color: var(--primary);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}
```

(`.spin` e `@keyframes spin` nas linhas seguintes continuam — são usados pelos ícones `Loader2`.)

- [ ] **Step 2: Adicionar o keyframe de flutuação contínua**

Após o `@keyframes bounce-in` (linhas 2032-2037), adicionar:

```css
@keyframes mark-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
```

- [ ] **Step 3: Trocar a animação one-shot da marca por entrada + loop**

Substituir o bloco das linhas 2134-2143 por:

```css
/* === Loading de rota: marca com entrada + flutuação contínua === */
.loading-mark {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 18px;
  background: var(--section);
  box-shadow: 0 5px 0 var(--section-deep);
  animation:
    bounce-in .6s cubic-bezier(.34, 1.56, .64, 1) both,
    mark-float 1.6s ease-in-out .6s infinite;
}
```

Como `mark-float` vem depois na lista e só atua a partir de 0.6s (delay), a entrada `bounce-in` acontece primeiro e a flutuação assume em loop — a marca nunca fica parada.

- [ ] **Step 4: Escalonar o shimmer dos skeletons**

Após o bloco `.skeleton-circle` (linha 2132), adicionar:

```css
.screen-skeleton .skeleton:nth-child(2) { animation-delay: .15s; }
.screen-skeleton .skeleton:nth-child(3) { animation-delay: .3s; }
.screen-skeleton .skeleton:nth-child(4) { animation-delay: .45s; }
.screen-skeleton .skeleton:nth-child(5) { animation-delay: .6s; }
.screen-skeleton .skeleton:nth-child(6) { animation-delay: .75s; }
```

- [ ] **Step 5: Verificação**

Run: `npm run lint && npm run build`
Expected: build sem erros.

Verificação manual: `npm run dev`, navegar entre Home, Progresso, Palavras e Calendário com throttling de rede (DevTools → Network → Slow 3G) para segurar as telas de loading.
Expected: marca flutuando continuamente na tela raiz; skeletons com shimmer dessincronizado. (O bloco `prefers-reduced-motion` das linhas 1852-1861 já neutraliza tudo quando ativo — sem trabalho extra.)

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "fix(ui): loading de rota com flutuação contínua e shimmer escalonado nos skeletons"
```

---

## Verificação final (após todas as tasks)

- [ ] `npm run lint && npm run typecheck && npm run test:unit && npm run build` — tudo verde.
- [ ] Teste manual ponta a ponta no chat: ditar com pausas → texto corrigido; ouvir respostas em sequência no iPhone → volume consistente; telas de loading animadas.
