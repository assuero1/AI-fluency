"use client";

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

export function reportDeviceFallback(text: string, languageCode: string | undefined, reason?: string) {
  const body = JSON.stringify({
    event_name: "voice_device_fallback",
    payload: { language: languageCode ?? "", textLength: text.length, reason: reason ?? "" }
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
  // iOS dispara onend E onerror ("interrupted") para a mesma utterance quando o
  // próximo speak cancela a fila — sem o guard cada frase encadeava duas vezes.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
  return utterance;
}
