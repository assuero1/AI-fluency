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
    setCurrentLine(index);
    setStatus("loading");

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante
    // antes de tocar após uso do microfone.
    const routeRestoreWait = msUntilAudioRouteRestored();
    if (routeRestoreWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, routeRestoreWait));
    }
    const generation = generationRef.current;

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
