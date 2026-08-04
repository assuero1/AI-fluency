"use client";

import { Loader2, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";

type VoiceButtonProps = {
  text: string;
  label?: string;
  compact?: boolean;
  languageCode?: string;
  preload?: boolean;
  playbackRate?: number;
  onPlayback?: (event: { replay: boolean; slow: boolean; deviceFallback: boolean }) => void;
  onAudioFailure?: () => void;
};

type VoiceStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

let activeVoice: { owner: symbol; stop: () => void } | null = null;
const speechRequests = new Map<string, Promise<string>>();

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

export function VoiceButton({ text, label = "Ouvir", compact = false, languageCode, preload = false, playbackRate = 1, onPlayback, onAudioFailure }: VoiceButtonProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadPromiseRef = useRef<Promise<HTMLAudioElement> | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ownerRef = useRef(Symbol("voice-button"));
  const playbackRequestedRef = useRef(false);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = null;
    if (activeVoice?.owner === ownerRef.current) activeVoice = null;
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setStatus("idle");
  }, []);

  const startDeviceFallback = useCallback(() => {
    reportDeviceFallback(text, languageCode);
    releaseAudio();
    const utterance = playDeviceSpeech(text, languageCode, playbackRate, () => {
      speechUtteranceRef.current = null;
      setStatus("ended");
    });
    if (!utterance) {
      setStatus("error");
      onAudioFailure?.();
      return;
    }
    speechUtteranceRef.current = utterance;
    setStatus("playing");
    onPlayback?.({ replay: false, slow: playbackRate < 1, deviceFallback: true });
  }, [languageCode, onAudioFailure, onPlayback, playbackRate, releaseAudio, text]);

  const createAudio = useCallback((audioUrl: string) => {
    releaseAudio();
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) setStatus("ended");
      else if (speechUtteranceRef.current) {
        window.speechSynthesis?.cancel();
        speechUtteranceRef.current = null;
        setStatus("ended");
      }
    };
    audio.onerror = () => {
      if (audioRef.current !== audio) return;
      // Preload failures stay silent; only user-initiated playback falls back to device speech.
      if (!playbackRequestedRef.current) {
        releaseAudio();
        setStatus("error");
        onAudioFailure?.();
        return;
      }
      startDeviceFallback();
    };
    audio.load();
    setStatus("ready");
    return audio;
  }, [onAudioFailure, releaseAudio, startDeviceFallback]);

  const recreateAudio = useCallback(() => {
    if (!audioUrlRef.current) return null;
    return createAudio(audioUrlRef.current);
  }, [createAudio]);

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

  const ensureAudio = useCallback(async () => {
    if (audioRef.current) return audioRef.current;
    if (loadPromiseRef.current) return loadPromiseRef.current;

    setStatus("loading");
    const promise = requestSpeech(text, languageCode).then((audioUrl) => {
      audioUrlRef.current = audioUrl;
      return createAudio(audioUrl);
    });
    loadPromiseRef.current = promise;
    try {
      return await promise;
    } catch (error) {
      releaseAudio();
      setStatus("error");
      throw error;
    } finally {
      loadPromiseRef.current = null;
    }
  }, [createAudio, languageCode, releaseAudio, text]);

  useEffect(() => () => {
    speechUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    releaseAudio();
  }, [releaseAudio]);

  useEffect(() => {
    if (!preload || !text.trim()) return;
    void ensureAudio().catch(() => undefined);
  }, [ensureAudio, preload, text]);

  async function togglePlayback() {
    if (!text.trim()) return;
    playbackRequestedRef.current = true;

    const existing = audioRef.current;
    if (!existing && speechUtteranceRef.current && status === "playing") {
      window.speechSynthesis?.pause();
      setStatus("paused");
      return;
    }
    if (!existing && speechUtteranceRef.current && status === "paused") {
      window.speechSynthesis?.resume();
      setStatus("playing");
      return;
    }
    if (existing && status === "playing") {
      existing.pause();
      setStatus("paused");
      return;
    }
    if (existing && status === "paused") {
      await playExisting(existing);
      return;
    }
    if (existing && status === "ready") {
      await playExisting(existing);
      return;
    }
    if (existing && status === "ended") {
      const replayAudio = recreateAudio();
      if (replayAudio) await playExisting(replayAudio);
      else {
        existing.currentTime = 0;
        await playExisting(existing);
      }
      return;
    }

    try {
      const audio = await ensureAudio();
      await playExisting(audio);
    } catch {
      startDeviceFallback();
    }
  }

  const accessibleLabel = voiceLabel(status, label);
  const StatusIcon = status === "loading" ? Loader2 : status === "playing" ? Pause : status === "ended" ? RotateCcw : compact ? Volume2 : Play;

  if (compact) {
    return (
      <button className="voice-icon-button" onClick={togglePlayback} type="button" aria-label={accessibleLabel} title={accessibleLabel}>
        <StatusIcon className={status === "loading" ? "spin" : undefined} />
      </button>
    );
  }

  return (
    <button aria-label={accessibleLabel} className={status === "error" ? "audio-pill audio-error" : "audio-pill"} onClick={togglePlayback} type="button">
      <StatusIcon className={status === "loading" ? "spin" : undefined} />
      <Wave playing={status === "playing"} />
      <span aria-live="polite">{voiceStatusText(status, label)}</span>
    </button>
  );
}

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

function playDeviceSpeech(text: string, languageCode: string | undefined, rate: number, onEnd: () => void) {
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

function requestSpeech(text: string, languageCode: string | undefined) {
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

function voiceLabel(status: VoiceStatus, label: string) {
  if (status === "loading") return "Preparando áudio";
  if (status === "ready") return "Reproduzir áudio";
  if (status === "playing") return "Pausar áudio";
  if (status === "paused") return "Continuar áudio";
  if (status === "ended") return "Reproduzir áudio novamente";
  if (status === "error") return "Voz indisponível. Tentar novamente";
  return label;
}

function voiceStatusText(status: VoiceStatus, label: string) {
  if (status === "loading") return "preparando";
  if (status === "ready") return "reproduzir";
  if (status === "playing") return "tocando";
  if (status === "paused") return "pausado";
  if (status === "ended") return "ouvir novamente";
  if (status === "error") return "voz indisponível";
  return label;
}
