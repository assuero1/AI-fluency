"use client";

import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSeamlessTrack, SeamlessPlayer } from "@/lib/learning/seamless-audio";
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

  const currentLineRef = useRef(0);
  const playerRef = useRef<SeamlessPlayer | null>(null);
  const offsetsRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const ownerRef = useRef(Symbol("message-audio-player"));
  const deviceFallbackRef = useRef(false);
  const fallbackReportedRef = useRef(false);
  const generationRef = useRef(0); // invalida callbacks antigos

  const setLine = useCallback((index: number) => {
    currentLineRef.current = index;
    setCurrentLine(index);
  }, []);

  const releaseAudio = useCallback(() => {
    generationRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    playerRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    releaseAudio();
    setStatus("idle");
    setLine(0);
  }, [releaseAudio, setLine]);

  const enableDeviceFallback = useCallback(() => {
    if (!deviceFallbackRef.current) {
      deviceFallbackRef.current = true;
      if (!fallbackReportedRef.current) {
        fallbackReportedRef.current = true;
        reportDeviceFallback(text, languageCode);
      }
    }
  }, [languageCode, text]);

  /**
   * Prepara a faixa única da mensagem: busca o áudio de todas as frases em
   * paralelo e concatena num buffer contínuo, para a bolha tocar sem gaps.
   */
  const prepareTrack = useCallback(async (generation: number) => {
    if (playerRef.current) return true;
    try {
      const urls = await Promise.all(lines.map((line) => requestSpeech(line, languageCode)));
      if (generationRef.current !== generation) return false;
      const seamless = await buildSeamlessTrack(urls);
      if (generationRef.current !== generation) {
        void seamless.context.close();
        return false;
      }
      playerRef.current = new SeamlessPlayer(seamless);
      offsetsRef.current = seamless.partOffsets;
      return true;
    } catch {
      return false;
    }
  }, [languageCode, lines]);

  const startLineLoop = useCallback((generation: number) => {
    const step = () => {
      if (generationRef.current !== generation) return;
      const player = playerRef.current;
      const offsets = offsetsRef.current;
      if (!player || offsets.length === 0) return;
      const position = player.position();
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
    const player = playerRef.current;
    if (!player) return false;

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante
    // antes de tocar após uso do microfone.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return true;

    try {
      await player.play(time, () => {
        if (generationRef.current !== generation) return;
        cancelAnimationFrame(rafRef.current);
        setStatus("ended");
      });
      if (generationRef.current !== generation) {
        player.stop();
        return true;
      }
      setStatus("playing");
      startLineLoop(generation);
      return true;
    } catch {
      return false;
    }
  }, [startLineLoop]);

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
    setLine(index);
    setStatus("playing");
  }, [languageCode, lines, setLine]);

  const playLine = useCallback(async (index: number) => {
    if (index < 0 || index >= lines.length) return;
    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    releaseAudio();
    const generation = generationRef.current;
    setLine(index);
    setStatus("loading");

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

    const started = await startPlayerAt(offsetsRef.current[index] ?? 0, generation);
    if (!started && generationRef.current === generation) {
      enableDeviceFallback();
      playDeviceLine(index, generationRef.current);
    }
  }, [enableDeviceFallback, lines.length, playDeviceLine, prepareTrack, releaseAudio, setLine, startPlayerAt, stopForAnotherVoice]);

  async function togglePlayback() {
    if (!lines.length) return;

    if (status === "playing") {
      if (deviceFallbackRef.current) window.speechSynthesis?.pause();
      else {
        playerRef.current?.pause();
        cancelAnimationFrame(rafRef.current);
      }
      setStatus("paused");
      return;
    }
    if (status === "paused") {
      if (deviceFallbackRef.current) {
        window.speechSynthesis?.resume();
        setStatus("playing");
        return;
      }
      const player = playerRef.current;
      if (!player) {
        await playLine(currentLineRef.current);
        return;
      }
      const generation = generationRef.current;
      setStatus("loading");
      const started = await startPlayerAt(player.position(), generation);
      if (!started && generationRef.current === generation) await playLine(currentLineRef.current);
      return;
    }
    // idle | ended | error → começa (ou recomeça) da linha atual/0
    await playLine(status === "ended" ? 0 : currentLineRef.current);
  }

  function skipLine(delta: number) {
    const target = Math.min(Math.max(currentLineRef.current + delta, 0), lines.length - 1);
    if (target === currentLineRef.current && status !== "ended") return;

    if (status === "playing") {
      void playLine(target);
      return;
    }
    if (status === "paused" && !deviceFallbackRef.current && playerRef.current) {
      playerRef.current.setPosition(offsetsRef.current[target] ?? 0);
      setLine(target);
      return;
    }
    // No fallback (speechSynthesis) não é possível redirecionar uma utterance
    // pausada para outra linha, então o skip pausado toca a linha alvo na hora.
    if (status === "paused") {
      void playLine(target);
      return;
    }
    // idle/ended: apenas move o cursor, sem tocar
    releaseAudio();
    setLine(target);
    if (status === "ended") setStatus("idle");
  }

  // Preload da faixa completa (só na última mensagem): baixa e decodifica
  // todas as frases para o primeiro play começar sem espera.
  useEffect(() => {
    if (!preload || !lines.length || playerRef.current || deviceFallbackRef.current) return;
    const generation = generationRef.current;
    void prepareTrack(generation);
  }, [lines.length, preload, prepareTrack]);

  useEffect(() => () => {
    releaseAudio();
    playerRef.current?.dispose();
    playerRef.current = null;
    releaseActiveVoice(ownerRef.current);
  }, [releaseAudio]);

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
