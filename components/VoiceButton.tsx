"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  releaseActiveVoice,
  reportVoiceFailure,
  requestSpeech,
  unlockAudioForPlayback
} from "./voice-shared";

type VoiceButtonProps = {
  text: string;
  label?: string;
  compact?: boolean;
  languageCode?: string;
  preload?: boolean;
  playbackRate?: number;
  onPlayback?: (event: { replay: boolean; slow: boolean }) => void;
  onAudioFailure?: () => void;
};

type VoiceStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

const PLAY_RETRY_DELAY_MS = 300;

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
  const loadPromiseRef = useRef<Promise<HTMLAudioElement | null> | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ownerRef = useRef(Symbol("voice-button"));
  const playbackRequestedRef = useRef(false);
  const unlockedAudioRef = useRef<HTMLAudioElement | null>(null);
  const textRef = useRef(text);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = null;
    releaseActiveVoice(ownerRef.current);
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setStatus("idle");
  }, []);

  /** <audio> sem src, criado dentro do gesto do usuário para destravar o play() no iOS. */
  const ensureBareAudio = useCallback(() => {
    const existing = audioRef.current;
    if (existing) return existing;
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    return audio;
  }, []);

  const createAudio = useCallback((audioUrl: string) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    // Texto/palabra nueva (ej. cards de escucha consecutivos): el elemento reusa
    // el audio anterior; reseteo explícito para que el siguiente play() no
    // reproduzca la URL anterior.
    const urlChanged = audioUrlRef.current !== null && audioUrlRef.current !== audioUrl;
    audioUrlRef.current = audioUrl;
    audio.preload = "auto";
    audio.src = audioUrl;
    audio.onended = () => {
      if (audioRef.current === audio) setStatus("ended");
    };
    audio.onerror = () => {
      if (audioRef.current !== audio) return;
      // Falha de preload fica silenciosa; só falha iniciada pelo usuário vira telemetria.
      const requested = playbackRequestedRef.current;
      releaseAudio();
      setStatus("error");
      onAudioFailure?.();
      if (requested) reportVoiceFailure(text, languageCode, "audio element error");
    };
    audio.load();
    if (urlChanged) {
      audio.currentTime = 0;
      setStatus("idle");
    } else {
      setStatus("ready");
    }
    return audio;
  }, [languageCode, onAudioFailure, releaseAudio, text]);

  const recreateAudio = useCallback(() => {
    if (!audioUrlRef.current) return null;
    return createAudio(audioUrlRef.current);
  }, [createAudio]);

  const playExisting = useCallback(async (audio: HTMLAudioElement) => {
    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    audio.playbackRate = playbackRate;
    // iOS: se o microfone acabou de ser liberado, aguarda a AVAudioSession
    // restaurar a rota do alto-falante antes de tocar.
    const routeRestoreWait = msUntilAudioRouteRestored();
    if (routeRestoreWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, routeRestoreWait));
    }
    // Uma segunda tentativa cobre rejeições transitórias do iOS (sessão de
    // áudio ainda restaurando a rota depois do microfone).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await audio.play();
        setStatus("playing");
        onPlayback?.({ replay: audio.currentTime > 0, slow: playbackRate < 1 });
        return;
      } catch {
        // Outra voz pode ter assumido este elemento; não reporta nem retenta.
        if (audioRef.current !== audio) return;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, PLAY_RETRY_DELAY_MS));
      }
    }
    if (audioRef.current !== audio) return;
    setStatus("error");
    reportVoiceFailure(text, languageCode, "audio.play() rejected");
    onAudioFailure?.();
  }, [languageCode, onAudioFailure, onPlayback, playbackRate, stopForAnotherVoice, text]);

  const ensureAudio = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current && audioUrlRef.current) return audioRef.current;
    if (loadPromiseRef.current) return loadPromiseRef.current;

    setStatus("loading");
    const requestedText = text;
    const promise = requestSpeech(requestedText, languageCode).then((audioUrl) => {
      // A síntese pode resolver depois de o texto ter mudado (ex.: troca de
      // card); adotar esse áudio faria o próximo play repetir o conteúdo
      // anterior — o mesmo bug do áudio errado no card de escuta.
      if (textRef.current !== requestedText) return null;
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
      if (loadPromiseRef.current === promise) loadPromiseRef.current = null;
    }
  }, [createAudio, languageCode, releaseAudio, text]);

  useEffect(() => () => {
    releaseAudio();
  }, [releaseAudio]);

  // Troca de texto (ex.: card seguinte no treino): descarta o elemento e a URL
  // anteriores — sem isso ensureAudio devolvia o áudio do texto anterior e o
  // botão tocava a palavra do card anterior. Precisa rodar antes do efeito de
  // preload (declaração anterior = execução anterior no mesmo commit).
  useEffect(() => {
    textRef.current = text;
    releaseAudio();
    audioUrlRef.current = null;
    playbackRequestedRef.current = false;
    setStatus("idle");
  }, [releaseAudio, text]);

  useEffect(() => {
    if (!preload || !text.trim()) return;
    void ensureAudio().catch(() => undefined);
  }, [ensureAudio, preload, text]);

  async function togglePlayback() {
    if (!text.trim()) return;
    playbackRequestedRef.current = true;

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
    if (existing && audioUrlRef.current && status === "ready") {
      await playExisting(existing);
      return;
    }
    if (existing && audioUrlRef.current && status === "ended") {
      const replayAudio = recreateAudio();
      if (replayAudio) await playExisting(replayAudio);
      else {
        existing.currentTime = 0;
        await playExisting(existing);
      }
      return;
    }

    // idle | error | elemento sem src: destrava o <audio> ainda no gesto do
    // usuário — sem isso o play() depois dos awaits de rede é rejeitado no iOS.
    const audio = ensureBareAudio();
    if (unlockedAudioRef.current !== audio) {
      unlockedAudioRef.current = audio;
      unlockAudioForPlayback(audio);
    }

    try {
      const readyAudio = await ensureAudio();
      // null: o texto mudou enquanto a síntese estava em voo; o efeito de
      // troca de texto já resetou o estado para o conteúdo novo.
      if (!readyAudio) return;
      await playExisting(readyAudio);
    } catch (error) {
      setStatus("error");
      reportVoiceFailure(text, languageCode, error instanceof Error ? error.message : String(error));
      onAudioFailure?.();
    }
  }

  const accessibleLabel = voiceLabel(status, label);
  const icon =
    status === "loading" ? (
      <Loader2 aria-hidden="true" className="animate-spin" size={18} />
    ) : status === "playing" ? (
      <Pause aria-hidden="true" size={18} />
    ) : status === "ended" ? (
      <RotateCcw aria-hidden="true" size={18} />
    ) : compact ? (
      <Volume2 aria-hidden="true" size={18} />
    ) : (
      <Play aria-hidden="true" size={18} />
    );

  if (compact) {
    return (
      <button className="voice-icon-button" onClick={togglePlayback} type="button" aria-label={accessibleLabel} title={accessibleLabel}>
        {icon}
      </button>
    );
  }

  return (
    <button aria-label={accessibleLabel} className={status === "error" ? "audio-pill audio-error" : "audio-pill"} onClick={togglePlayback} type="button">
      {icon}
      <Wave playing={status === "playing"} />
      <span aria-live="polite">{voiceStatusText(status, label)}</span>
    </button>
  );
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
