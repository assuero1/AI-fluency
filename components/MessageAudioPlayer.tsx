"use client";

import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSeamlessTrack, type SeamlessTrack } from "@/lib/learning/seamless-audio";
import { splitIntoSentences } from "@/lib/learning/sentences";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  createStallTracker,
  releaseActiveVoice,
  reportVoiceFailure,
  requestSpeech,
  samplePlaybackStall,
  unlockAudioForPlayback
} from "./voice-shared";

type MessageAudioPlayerProps = {
  text: string;
  languageCode?: string;
  showTranscript: boolean;
  preload?: boolean;
};

type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

const PLAY_RETRY_DELAY_MS = 300;

export function MessageAudioPlayer({ text, languageCode, showTranscript, preload = false }: MessageAudioPlayerProps) {
  const lines = useMemo(() => splitIntoSentences(text), [text]);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [currentLine, setCurrentLine] = useState(0);

  const statusRef = useRef<PlayerStatus>("idle");
  const currentLineRef = useRef(0);
  const seamlessRef = useRef<SeamlessTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const ownerRef = useRef(Symbol("message-audio-player"));
  const unlockedRef = useRef(false);
  const unlockHandleRef = useRef<{ cancel: () => void } | null>(null);
  const stallTrackerRef = useRef(createStallTracker());
  const lastErrorRef = useRef("");
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
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    releaseAudio();
    setStatusTracked("idle");
    setLine(0);
  }, [releaseAudio, setLine, setStatusTracked]);

  /** Cria (uma única vez) o <audio> da mensagem, já com handlers de término,
   * pausa externa e erro. */
  const ensureAudioElement = useCallback(() => {
    const existing = audioRef.current;
    if (existing) return existing;
    const audio = new Audio();
    audio.preload = "auto";
    audio.onended = () => {
      if (statusRef.current !== "playing") return;
      cancelAnimationFrame(rafRef.current);
      setStatusTracked("ended");
    };
    // Pausa sem passar pelos botões (interrupção do iOS, pause() tardio de um
    // destravamento antigo): reconcilia a UI em vez de exibir "tocando" sem som.
    audio.onpause = () => {
      if (statusRef.current !== "playing") return;
      cancelAnimationFrame(rafRef.current);
      const atEnd = Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime >= audio.duration - 0.05;
      setStatusTracked(atEnd ? "ended" : "paused");
    };
    // Erro do elemento (fonte corrompida, blob revogado): estado de erro em
    // vez de loading/playing eterno.
    audio.onerror = () => {
      if (statusRef.current !== "playing" && statusRef.current !== "loading") return;
      cancelAnimationFrame(rafRef.current);
      reportVoiceFailure(text, languageCode, "audio element error");
      setStatusTracked("error");
    };
    audioRef.current = audio;
    return audio;
  }, [languageCode, setStatusTracked, text]);

  /**
   * Prepara a faixa única da mensagem: busca o áudio de todas as frases em
   * paralelo e concatena num WAV contínuo, para a bolha tocar num único
   * <audio> nativo, sem gaps entre as partes.
   */
  const prepareTrack = useCallback(async (generation: number) => {
    if (seamlessRef.current) return true;
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
        ensureAudioElement().src = seamless.audioUrl;
        return true;
      } catch (error) {
        lastErrorRef.current = error instanceof Error ? error.message : String(error);
      }
    }
    return false;
  }, [ensureAudioElement, languageCode, lines]);

  /** O watchdog esgotou as recuperações do episódio: nem re-seek + play()
   * revive o elemento — declara erro como nos demais caminhos de falha. */
  const giveUpStalledPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    reportVoiceFailure(text, languageCode, "playback stalled with no progress");
    setStatusTracked("error");
  }, [languageCode, setStatusTracked, text]);

  const startLineLoop = useCallback((generation: number) => {
    stallTrackerRef.current = createStallTracker();
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
      samplePlaybackStall(audio, stallTrackerRef.current, statusRef.current === "playing", giveUpStalledPlayback);
      rafRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [giveUpStalledPlayback, setLine]);

  /** Toca a faixa a partir de `time` segundos. Retorna false se falhar. */
  const startPlayerAt = useCallback(async (time: number, generation: number) => {
    const audio = audioRef.current;
    if (!audio) return false;

    // O destravamento do gesto não pode pausar o play real nem deixá-lo mudo.
    unlockHandleRef.current?.cancel();
    audio.muted = false;

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante
    // antes de tocar após uso do microfone.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return true;

    // Uma segunda tentativa cobre rejeições transitórias do iOS (sessão de
    // áudio ainda restaurando a rota depois do microfone).
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, PLAY_RETRY_DELAY_MS));
          if (generationRef.current !== generation) return true;
        }
      }
    }
    return false;
  }, [setStatusTracked, startLineLoop]);

  const playLine = useCallback(async (index: number) => {
    if (index < 0 || index >= lines.length) return;
    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    releaseAudio();
    const generation = generationRef.current;
    setLine(index);
    setStatusTracked("loading");

    // iOS: destrava o <audio> ainda no gesto do usuário — sem isso o play()
    // depois dos awaits de rede perde a "user activation" e é rejeitado.
    const audio = ensureAudioElement();
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      unlockHandleRef.current = unlockAudioForPlayback(audio);
    }

    const ready = await prepareTrack(generation);
    if (generationRef.current !== generation) return;
    if (!ready) {
      reportVoiceFailure(text, languageCode, lastErrorRef.current || "Kokoro synthesis failed");
      setStatusTracked("error");
      return;
    }

    const started = await startPlayerAt(seamlessRef.current?.partOffsets[index] ?? 0, generation);
    if (!started && generationRef.current === generation) {
      reportVoiceFailure(text, languageCode, "audio.play() rejected");
      setStatusTracked("error");
    }
  }, [ensureAudioElement, languageCode, lines.length, prepareTrack, releaseAudio, setLine, setStatusTracked, startPlayerAt, stopForAnotherVoice, text]);

  async function togglePlayback() {
    if (!lines.length) return;

    if (statusRef.current === "playing") {
      audioRef.current?.pause();
      cancelAnimationFrame(rafRef.current);
      setStatusTracked("paused");
      return;
    }
    if (statusRef.current === "paused") {
      const audio = audioRef.current;
      if (!audio || !seamlessRef.current) {
        await playLine(currentLineRef.current);
        return;
      }
      const generation = generationRef.current;
      setStatusTracked("loading");
      const started = await startPlayerAt(audio.currentTime, generation);
      if (!started && generationRef.current === generation) {
        reportVoiceFailure(text, languageCode, "audio.play() rejected");
        setStatusTracked("error");
      }
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
    if (statusRef.current === "paused") {
      if (audioRef.current && seamlessRef.current) {
        audioRef.current.currentTime = seamlessRef.current.partOffsets[target] ?? 0;
        setLine(target);
        return;
      }
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
    if (!preload || !lines.length || seamlessRef.current) return;
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
    "Ouvir mensagem";

  return (
    <div className="message-audio-player">
      {showTranscript || status === "error" ? (
        // No erro, o texto aparece MESMO com transcrição desligada — sem isso
        // o usuário ficaria sem ler a mensagem de jeito nenhum.
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
      {status === "error" ? (
        <p className="chat-audio-error-note" role="status">Áudio indisponível agora — leia a mensagem acima.</p>
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
        <button
          aria-label={playLabel}
          className={status === "error" ? "voice-icon-button audio-error" : "voice-icon-button"}
          onClick={togglePlayback}
          title={playLabel}
          type="button"
        >
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
