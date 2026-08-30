"use client";

import { prepareRouteNudgeElement, silentWavUri } from "@/lib/learning/speech";

type ActiveVoice = { owner: symbol; stop: () => void };

let activeVoice: ActiveVoice | null = null;
const speechRequests = new Map<string, Promise<string>>();
const captionedRequests = new Map<string, Promise<CaptionedSpeechResult>>();

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
  const key = `${languageCode ?? ""}\n${text}`;
  // refresh=true descarta uma URL resolvida antes (ex.: o áudio expirou no
  // servidor) e força um novo POST, que re-sintetiza se o cache sumiu.
  if (refresh) speechRequests.delete(key);
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

export function requestCaptionedSpeech(text: string, languageCode: string | undefined): Promise<CaptionedSpeechResult> {
  const key = `${languageCode ?? ""}\n${text}`;
  const existing = captionedRequests.get(key);
  if (existing) return existing;

  const request = fetch("/api/voice/captioned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, languageCode })
  }).then(async (response) => {
    const data = (await response.json()) as { ok?: boolean; audioUrl?: string; words?: CaptionedWord[]; error?: string };
    if (!response.ok || !data.ok || !data.audioUrl || !Array.isArray(data.words)) {
      throw new Error(data.error ?? "Audio unavailable.");
    }
    return { audioUrl: data.audioUrl, words: data.words };
  }).catch((error) => {
    captionedRequests.delete(key);
    throw error;
  });

  if (captionedRequests.size >= 100) {
    const oldestKey = captionedRequests.keys().next().value;
    if (oldestKey) captionedRequests.delete(oldestKey);
  }
  captionedRequests.set(key, request);
  return request;
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
 */
export function unlockAudioForPlayback(audio: HTMLAudioElement) {
  try {
    // Destrava também o elemento dedicado do nudge de rota (lib/learning/speech)
    // neste mesmo gesto: é ele que devolve o áudio ao alto-falante depois do
    // ditado, quando o play() programático já não tem gesto no iOS.
    prepareRouteNudgeElement();
    const position = audio.currentTime;
    const hadSource = Boolean(audio.src);
    if (!hadSource) audio.src = silentWavUri();
    audio.muted = true;
    const attempt = audio.play();
    const finish = () => {
      audio.pause();
      audio.muted = false;
      if (hadSource) {
        try {
          audio.currentTime = position;
        } catch {
          // Elemento ainda sem dados suficientes; a posição será redefinida no play real.
        }
      }
    };
    if (attempt && typeof attempt.then === "function") attempt.then(finish, finish);
    else finish();
  } catch {
    audio.muted = false;
  }
}
