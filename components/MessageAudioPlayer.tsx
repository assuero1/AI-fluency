"use client";

import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSeamlessTrack, type SeamlessTrack } from "@/lib/learning/seamless-audio";
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
  const [deviceFallback, setDeviceFallback] = useState(false);

  const statusRef = useRef<PlayerStatus>("idle");
  const currentLineRef = useRef(0);
  const seamlessRef = useRef<SeamlessTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const ownerRef = useRef(Symbol("message-audio-player"));
  const deviceFallbackRef = useRef(false);
  const fallbackReportedRef = useRef(false);
  const fallbackReasonRef = useRef("");
  const generationRef = useRef(0); // invalida callbacks antigos

  const setStatusTracked = useCallback((next: PlayerStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const setLine = useCallback((index: number) => {
    currentLineRef.current = index;
    setCurrentLine(index);
  }, []);

  const releaseAudio = useCallback(() => {
    generationRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    releaseAudio();
    setStatusTracked("idle");
    setLine(0);
  }, [releaseAudio, setLine, setStatusTracked]);

  const enableDeviceFallback = useCallback((reason?: string) => {
    if (reason) fallbackReasonRef.current = reason;
    setDeviceFallback(true);
    if (!deviceFallbackRef.current) {
      deviceFallbackRef.current = true;
      if (!fallbackReportedRef.current) {
        fallbackReportedRef.current = true;
        reportDeviceFallback(text, languageCode, fallbackReasonRef.current || undefined);
      }
    }
  }, [languageCode, text]);

  /**
   * Prepara a faixa única da mensagem: busca o áudio de todas as frases em
   * paralelo e concatena num WAV contínuo, para a bolha tocar num único
   * <audio> nativo, sem gaps entre as partes.
   */
  const prepareTrack = useCallback(async (generation: number) => {
    if (audioRef.current) return true;
    // Uma segunda tentativa com refresh cobre URLs de áudio que expiraram no
    // servidor depois do POST original (ex.: cache podado ou restart).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const urls = await Promise.all(lines.map((line) => requestSpeech(line, languageCode, attempt > 0)));
        if (generationRef.current !== generation) return false;
        const seamless = await buildSeamlessTrack(urls);
        if (generationRef.current !== generation) {
          seamless.dispose();
          return false;
        }
        seamlessRef.current?.dispose();
        seamlessRef.current = seamless;
        const audio = new Audio(seamless.audioUrl);
        audio.preload = "auto";
        audio.onended = () => {
          if (statusRef.current !== "playing") return;
          cancelAnimationFrame(rafRef.current);
          setStatusTracked("ended");
        };
        audioRef.current = audio;
        return true;
      } catch (error) {
        fallbackReasonRef.current = error instanceof Error ? error.message : String(error);
      }
    }
    return false;
  }, [languageCode, lines, setStatusTracked]);

  const startLineLoop = useCallback((generation: number) => {
    const step = () => {
      if (generationRef.current !== generation) return;
      const audio = audioRef.current;
      const offsets = seamlessRef.current?.partOffsets ?? [];
      if (!audio || offsets.length === 0) return;
      const position = audio.currentTime;
      let line = offsets.length - 1;
      for (let index = 0; index < offsets.length; index += 1) {
        if (position < offsets[index]) {
          line = index - 1;
          break;
        }
      }
      line = Math.max(0, line);
      if (line !== currentLineRef.current) setLine(line);
      rafRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [setLine]);

  /** Toca a faixa a partir de `time` segundos. Retorna false se falhar. */
  const startPlayerAt = useCallback(async (time: number, generation: number) => {
    const audio = audioRef.current;
    if (!audio) return false;

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante
    // antes de tocar após uso do microfone.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return true;

    try {
      audio.currentTime = time;
      await audio.play();
      if (generationRef.current !== generation) {
        audio.pause();
        return true;
      }
      setStatusTracked("playing");
      startLineLoop(generation);
      return true;
    } catch {
      return false;
    }
  }, [setStatusTracked, startLineLoop]);

  const playDeviceLine = useCallback((index: number, generation: number) => {
    const utterance = playDeviceSpeech(lines[index], languageCode, 1, () => {
      if (generationRef.current !== generation) return;
      const next = index + 1;
      if (next < lines.length) playDeviceLine(next, generation);
      else setStatusTracked("ended");
    });
    if (!utterance) {
      setStatusTracked("error");
      return;
    }
    setLine(index);
    setStatusTracked("playing");
  }, [languageCode, lines, setLine, setStatusTracked]);

  const playLine = useCallback(async (index: number) => {
    if (index < 0 || index >= lines.length) return;
    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    releaseAudio();
    const generation = generationRef.current;
    setLine(index);
    setStatusTracked("loading");

    if (deviceFallbackRef.current) {
      playDeviceLine(index, generation);
      return;
    }

    const ready = await prepareTrack(generation);
    if (generationRef.current !== generation) return;
    if (!ready) {
      enableDeviceFallback();
      playDeviceLine(index, generationRef.current);
      return;
    }

    const started = await startPlayerAt(seamlessRef.current?.partOffsets[index] ?? 0, generation);
    if (!started && generationRef.current === generation) {
      enableDeviceFallback("audio.play() rejected");
      playDeviceLine(index, generationRef.current);
    }
  }, [enableDeviceFallback, lines.length, playDeviceLine, prepareTrack, releaseAudio, setLine, setStatusTracked, startPlayerAt, stopForAnotherVoice]);

  async function togglePlayback() {
    if (!lines.length) return;

    if (statusRef.current === "playing") {
      if (deviceFallbackRef.current) window.speechSynthesis?.pause();
      else {
        audioRef.current?.pause();
        cancelAnimationFrame(rafRef.current);
      }
      setStatusTracked("paused");
      return;
    }
    if (statusRef.current === "paused") {
      if (deviceFallbackRef.current) {
        window.speechSynthesis?.resume();
        setStatusTracked("playing");
        return;
      }
      const audio = audioRef.current;
      if (!audio) {
        await playLine(currentLineRef.current);
        return;
      }
      const generation = generationRef.current;
      setStatusTracked("loading");
      const started = await startPlayerAt(audio.currentTime, generation);
      if (!started && generationRef.current === generation) await playLine(currentLineRef.current);
      return;
    }
    // idle | ended | error → começa (ou recomeça) da linha atual/0
    await playLine(statusRef.current === "ended" ? 0 : currentLineRef.current);
  }

  function skipLine(delta: number) {
    const target = Math.min(Math.max(currentLineRef.current + delta, 0), lines.length - 1);
    if (target === currentLineRef.current && statusRef.current !== "ended") return;

    if (statusRef.current === "playing") {
      void playLine(target);
      return;
    }
    if (statusRef.current === "paused" && !deviceFallbackRef.current && audioRef.current) {
      audioRef.current.currentTime = seamlessRef.current?.partOffsets[target] ?? 0;
      setLine(target);
      return;
    }
    // No fallback (speechSynthesis) não é possível redirecionar uma utterance
    // pausada para outra linha, então o skip pausado toca a linha alvo na hora.
    if (statusRef.current === "paused") {
      void playLine(target);
      return;
    }
    // idle/ended: apenas move o cursor, sem tocar
    releaseAudio();
    setLine(target);
    if (statusRef.current === "ended") setStatusTracked("idle");
  }

  // Preload da faixa completa (só na última mensagem): baixa e decodifica
  // todas as frases para o primeiro play começar sem espera.
  useEffect(() => {
    if (!preload || !lines.length || audioRef.current || deviceFallbackRef.current) return;
    const generation = generationRef.current;
    void prepareTrack(generation);
  }, [lines.length, preload, prepareTrack]);

  useEffect(() => () => {
    releaseAudio();
    seamlessRef.current?.dispose();
    seamlessRef.current = null;
    audioRef.current = null;
    releaseActiveVoice(ownerRef.current);
  }, [releaseAudio]);

  const PlayIcon = status === "loading" ? Loader2 : status === "playing" ? Pause : status === "ended" ? RotateCcw : Play;
  const playLabel =
    status === "loading" ? "Preparando áudio" :
    status === "playing" ? "Pausar áudio" :
    status === "paused" ? "Continuar áudio" :
    status === "ended" ? "Ouvir novamente" :
    status === "error" ? "Voz indisponível. Tentar novamente" :
    deviceFallback ? "Ouvir com a voz do dispositivo (Kokoro indisponível)" :
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
