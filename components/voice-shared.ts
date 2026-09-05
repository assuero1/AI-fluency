"use client";

import { prepareRouteNudgeElement, silentWavUri } from "@/lib/learning/speech";

type ActiveVoice = { owner: symbol; stop: () => void };

let activeVoice: ActiveVoice | null = null;
const captionedRequests = new Map<string, Promise<CaptionedSpeechResult>>();

// Aquece a conexão HTTP com o servidor Next.js uma única vez por sessão de
// página — resolve o TCP/TLS handshake antes do usuário clicar em Play,
// eliminando ~100 ms de latência na conexão fria.
if (typeof fetch !== "undefined") {
  void fetch("/api/voice/warmup", { keepalive: true }).catch(() => undefined);
}

export type CaptionedWord = {
  word: string;
  start_time: number;
  end_time: number;
};

export type CaptionedSpeechResult = {
  audioUrl: string;
  words: CaptionedWord[];
};

/** Para a voz ativa de outro owner (se houver) e registra a nova voz ativa. */
export function claimActiveVoice(owner: symbol, stop: () => void) {
  if (activeVoice?.owner !== owner) activeVoice?.stop();
  activeVoice = { owner, stop };
}

/** Limpa o registro de voz ativa, mas apenas se o owner ainda for o atual. */
export function releaseActiveVoice(owner: symbol) {
  if (activeVoice?.owner === owner) activeVoice = null;
}

export function requestSpeech(text: string, languageCode: string | undefined, refresh = false): Promise<string> {
  return requestCaptionedSpeech(text, languageCode, refresh).then((result) => result.audioUrl);
}

export function requestCaptionedSpeech(text: string, languageCode: string | undefined, refresh = false): Promise<CaptionedSpeechResult> {
  const key = `${languageCode ?? ""}\n${text}`;
  if (refresh) captionedRequests.delete(key);
  const existing = captionedRequests.get(key);
  if (existing) return existing;
  const request = fetch("/api/voice/captioned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, languageCode })
  }).then(async (response) => {
    const data = (await response.json()) as { ok?: boolean; audioUrl?: string; words?: CaptionedWord[]; error?: string };
    if (!response.ok || !data.ok || !data.audioUrl) throw new Error(data.error ?? "Audio unavailable.");
    return { audioUrl: data.audioUrl, words: Array.isArray(data.words) ? data.words : [] };
  }).catch((error) => {
    if (captionedRequests.get(key) === request) captionedRequests.delete(key);
    throw error;
  });
  if (captionedRequests.size >= 100) {
    const oldestKey = captionedRequests.keys().next().value;
    if (oldestKey) captionedRequests.delete(oldestKey);
  }
  captionedRequests.set(key, request);
  return request;
}

/** Pré-carrega bytes comprimidos no cache HTTP sem decodificar/reempacotar. */
const preloadedAudio = new Map<string, Promise<void>>();
export function preloadSpeechAudio(text: string, languageCode?: string) {
  return requestSpeech(text, languageCode).then((url) => {
    const existing = preloadedAudio.get(url);
    if (existing) return existing;
    const task = fetch(url, { cache: "force-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
      // Drena o corpo para aquecer o cache, sem manter uma cópia em memória JS.
      const reader = response.body?.getReader();
      if (reader) { while (!(await reader.read()).done) { /* consume */ } }
    }).catch((error) => { preloadedAudio.delete(url); throw error; });
    if (preloadedAudio.size >= 20) preloadedAudio.delete(preloadedAudio.keys().next().value!);
    preloadedAudio.set(url, task);
    return task;
  });
}

export function reportVoiceFailure(text: string, languageCode: string | undefined, reason: string) {
  const body = JSON.stringify({
    event_name: "voice_kokoro_failure",
    payload: { language: languageCode ?? "", textLength: text.length, reason }
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

/**
 * Destrava um <audio> no iOS dentro do gesto do usuário: toca um trecho
 * silencioso (ou o próprio src já carregado) com volume zerado e pausa. Sem
 * isso, o play() chamado depois de awaits de rede perde a "user activation" e
 * é rejeitado ("audio.play() rejected" — maior causa de falha em produção).
 *
 * Retorna um handle: chame `cancel()` antes do play real — o pause() de
 * fechamento do destravamento, quando chega depois do play legítimo, pausava
 * o elemento com a UI em "tocando" (bolha muda, sem som).
 */
export type AudioUnlockHandle = { cancel: () => void };

export function unlockAudioForPlayback(audio: HTMLAudioElement): AudioUnlockHandle {
  let cancelled = false;
  try {
    // Destrava também o elemento dedicado do nudge de rota (lib/learning/speech)
    // neste mesmo gesto: é ele que devolve o áudio ao alto-falante depois do
    // ditado, quando o play() programático já não tem gesto no iOS.
    prepareRouteNudgeElement();
    const position = audio.currentTime;
    const hadSource = Boolean(audio.src);
    if (!hadSource) audio.src = silentWavUri();
    audio.muted = true;
    const finish = () => {
      audio.muted = false;
      if (cancelled) return;
      audio.pause();
      if (hadSource) {
        try {
          audio.currentTime = position;
        } catch {
          // Elemento ainda sem dados suficientes; a posição será redefinida no play real.
        }
      }
    };
    const attempt = audio.play();
    if (attempt && typeof attempt.then === "function") attempt.then(finish, finish);
    else finish();
  } catch {
    audio.muted = false;
  }
  return {
    cancel: () => {
      cancelled = true;
      audio.muted = false;
    }
  };
}

const HAVE_FUTURE_DATA = 3;
/** Frames (~1s a 60fps) de posição congelada antes de chutar o motor. */
export const STALL_RECOVER_FRAMES = 60;
/** Tentativas de recuperação por episódio antes de declarar erro. */
export const STALL_MAX_ATTEMPTS = 3;

export type StallTracker = {
  /** Última posição vista, para detectar avanço. */
  position: number;
  /** Frames consecutivos sem avanço. */
  frames: number;
  /** Recuperações tentadas no episódio atual de travamento. */
  attempts: number;
  /** Episódio encerrado com erro; aguarda a posição voltar a andar. */
  gaveUp: boolean;
};

export function createStallTracker(): StallTracker {
  return { position: 0, frames: 0, attempts: 0, gaveUp: false };
}

/**
 * Watchdog de "tocando sem avançar": com a UI em playing, dados prontos
 * (readyState ≥ HAVE_FUTURE_DATA) e posição congelada por ~1s, o motor de
 * mídia (iOS/WebKit, sobretudo na volta da rota depois do ditado) travou.
 * O mesmo re-seek minúsculo + play() do botão de avançar o destrava. Após
 * STALL_MAX_ATTEMPTS tentativas no mesmo episódio, aciona onGiveUp (estado
 * de erro). Chamar a cada frame do loop de destaque; devolve o tracker.
 */
export function samplePlaybackStall(
  audio: Pick<HTMLAudioElement, "paused" | "ended" | "readyState" | "duration" | "currentTime" | "play">,
  tracker: StallTracker,
  statusPlaying: boolean,
  onGiveUp: () => void
): StallTracker {
  const atEnd = Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime >= audio.duration - 0.05;
  const canStall = statusPlaying && !audio.paused && !audio.ended && !atEnd && audio.readyState >= HAVE_FUTURE_DATA;
  const advanced = Math.abs(audio.currentTime - tracker.position) > 0.01;
  if (!canStall || advanced) {
    tracker.position = audio.currentTime;
    tracker.frames = 0;
    tracker.attempts = 0;
    tracker.gaveUp = false;
    return tracker;
  }
  if (tracker.gaveUp) return tracker;
  tracker.frames += 1;
  if (tracker.frames < STALL_RECOVER_FRAMES) return tracker;
  tracker.frames = 0;
  if (tracker.attempts >= STALL_MAX_ATTEMPTS) {
    tracker.gaveUp = true;
    onGiveUp();
    return tracker;
  }
  tracker.attempts += 1;
  audio.currentTime = Math.max(0, audio.currentTime - 0.05);
  tracker.position = audio.currentTime;
  void audio.play().catch(() => undefined);
  return tracker;
}
