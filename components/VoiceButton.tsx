"use client";

import { Loader2, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type VoiceButtonProps = {
  text: string;
  label?: string;
  compact?: boolean;
  languageCode?: string;
  preload?: boolean;
};

type VoiceStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

let activeVoice: { owner: symbol; stop: () => void } | null = null;
const speechRequests = new Map<string, Promise<string>>();

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

export function VoiceButton({ text, label = "Ouvir", compact = false, languageCode, preload = false }: VoiceButtonProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadPromiseRef = useRef<Promise<HTMLAudioElement> | null>(null);
  const ownerRef = useRef(Symbol("voice-button"));

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

  const playExisting = useCallback(async (audio: HTMLAudioElement) => {
    if (activeVoice?.owner !== ownerRef.current) activeVoice?.stop();
    activeVoice = { owner: ownerRef.current, stop: stopForAnotherVoice };
    try {
      await audio.play();
      setStatus("playing");
    } catch {
      setStatus("ready");
    }
  }, [stopForAnotherVoice]);

  const ensureAudio = useCallback(async () => {
    if (audioRef.current) return audioRef.current;
    if (loadPromiseRef.current) return loadPromiseRef.current;

    setStatus("loading");
    const promise = requestSpeech(text, languageCode).then((audioUrl) => {
      releaseAudio();
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audioRef.current = audio;
      audio.onended = () => setStatus("ended");
      audio.onerror = () => {
        releaseAudio();
        setStatus("error");
      };
      audio.load();
      setStatus("ready");
      return audio;
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
  }, [languageCode, releaseAudio, text]);

  useEffect(() => () => releaseAudio(), [releaseAudio]);

  useEffect(() => {
    if (!preload || !text.trim()) return;
    void ensureAudio().catch(() => undefined);
  }, [ensureAudio, preload, text]);

  async function togglePlayback() {
    if (!text.trim()) return;

    const existing = audioRef.current;
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
      existing.currentTime = 0;
      await playExisting(existing);
      return;
    }

    try {
      const audio = await ensureAudio();
      await playExisting(audio);
    } catch {
      releaseAudio();
      setStatus("error");
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
      <StatusIcon className={status === "loading" ? "spin" : undefined} fill={StatusIcon === Play ? "#217a38" : undefined} />
      <Wave />
      <span aria-live="polite">{voiceStatusText(status, label)}</span>
    </button>
  );
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
