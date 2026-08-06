"use client";

import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeIndexAtTime,
  alignWords,
  hasUsableAlignment,
  MAX_CAPTIONED_SEGMENT_LENGTH,
  segmentMessage,
  skipAlignedIndex,
  timedIndices,
  tokenizeForCaptions,
  type AlignedToken
} from "@/lib/learning/captions";
import { buildSeamlessTrack, SeamlessPlayer } from "@/lib/learning/seamless-audio";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  releaseActiveVoice,
  requestCaptionedSpeech,
  type CaptionedWord
} from "./voice-shared";
import { MessageAudioPlayer } from "./MessageAudioPlayer";

type MessageWordPlayerProps = {
  text: string;
  languageCode?: string;
  showTranscript: boolean;
  preload?: boolean;
};

type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
type PlayerMode = "word" | "legacy";

type WordSegment = {
  text: string;
  audioUrl: string;
  words: CaptionedWord[];
  offset: number;
};

type CaptionedTrack = {
  segments: WordSegment[];
  aligned: AlignedToken[];
};

function buildTrackAlignment(segments: WordSegment[]) {
  const aligned: AlignedToken[] = [];
  segments.forEach((segment, segmentIndex) => {
    const tokens = tokenizeForCaptions(segment.text);
    // Junção entre segmentos: o último token do segmento anterior ganha espaço.
    if (segmentIndex > 0 && aligned.length > 0 && tokens.length > 0 && !aligned[aligned.length - 1].spaceAfter) {
      aligned[aligned.length - 1].spaceAfter = " ";
    }
    alignWords(tokens, segment.words).forEach((token) => {
      aligned.push({
        text: token.text,
        spaceAfter: token.spaceAfter,
        start: typeof token.start === "number" ? token.start + segment.offset : undefined,
        end: typeof token.end === "number" ? token.end + segment.offset : undefined
      });
    });
  });
  return aligned;
}

export function MessageWordPlayer({ text, languageCode, showTranscript, preload = false }: MessageWordPlayerProps) {
  const [mode, setMode] = useState<PlayerMode>("word");
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [track, setTrackState] = useState<CaptionedTrack | null>(null);
  const [activeWord, setActiveWordState] = useState(-1);
  const [selectedIndex, setSelectedIndexState] = useState(0);

  const trackRef = useRef<CaptionedTrack | null>(null);
  const activeWordRef = useRef(-1);
  const selectedIndexRef = useRef(0);
  const playerRef = useRef<SeamlessPlayer | null>(null);
  const rafRef = useRef(0);
  const generationRef = useRef(0); // invalida callbacks antigos
  const ownerRef = useRef(Symbol("message-word-player"));
  const captionedFailedRef = useRef(false);

  const setTrack = useCallback((next: CaptionedTrack | null) => {
    trackRef.current = next;
    setTrackState(next);
  }, []);

  const setActiveWord = useCallback((index: number) => {
    activeWordRef.current = index;
    setActiveWordState(index);
  }, []);

  const setSelectedIndex = useCallback((index: number) => {
    selectedIndexRef.current = index;
    setSelectedIndexState(index);
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
    setSelectedIndex(0);
    setActiveWord(-1);
  }, [releaseAudio, setActiveWord, setSelectedIndex]);

  const enterLegacyMode = useCallback(() => {
    captionedFailedRef.current = true;
    releaseAudio();
    setStatus("idle");
    setMode("legacy");
  }, [releaseAudio]);

  const startHighlightLoop = useCallback((generation: number) => {
    const step = () => {
      if (generationRef.current !== generation) return;
      const player = playerRef.current;
      const current = trackRef.current;
      if (!player || !current) return;
      const index = activeIndexAtTime(current.aligned, player.position());
      if (index !== activeWordRef.current) setActiveWord(index);
      rafRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [setActiveWord]);

  const loadCaptioned = useCallback(async () => {
    if (captionedFailedRef.current) return;
    setStatus("loading");
    const generation = ++generationRef.current;
    try {
      const texts = segmentMessage(text);
      if (texts.length === 0) throw new Error("Empty message.");
      if (texts.some((segment) => segment.length > MAX_CAPTIONED_SEGMENT_LENGTH)) throw new Error("Message too long.");

      // Busca os segmentos em paralelo: no cache frio cada um custa uma
      // síntese TTS, e em série o primeiro play esperaria N round-trips.
      const results = await Promise.all(texts.map((segmentText) => requestCaptionedSpeech(segmentText, languageCode)));
      if (generationRef.current !== generation) return;

      const segments: WordSegment[] = results.map((result, resultIndex) => ({
        text: texts[resultIndex],
        audioUrl: result.audioUrl,
        words: result.words,
        offset: 0
      }));

      // Voz sem timestamps no servidor (words vazio) → player legado, sem
      // gastar o download do áudio aqui.
      if (!hasUsableAlignment(buildTrackAlignment(segments))) {
        enterLegacyMode();
        return;
      }

      // Monta UM buffer contínuo com todos os segmentos: a bolha toca como um
      // áudio único, sem gap entre as partes.
      const seamless = await buildSeamlessTrack(segments.map((segment) => segment.audioUrl));
      if (generationRef.current !== generation) {
        void seamless.context.close();
        return;
      }
      seamless.partOffsets.forEach((offset, segmentIndex) => {
        if (segments[segmentIndex]) segments[segmentIndex].offset = offset;
      });

      playerRef.current?.dispose();
      playerRef.current = new SeamlessPlayer(seamless);
      setTrack({ segments, aligned: buildTrackAlignment(segments) });
      setSelectedIndex(0);
      setActiveWord(-1);
      setStatus("idle");
    } catch {
      if (generationRef.current !== generation) return;
      enterLegacyMode();
    }
  }, [enterLegacyMode, languageCode, setActiveWord, setSelectedIndex, setTrack, text]);

  /** Toca a faixa a partir de `time` segundos (posição absoluta no buffer). */
  const playAt = useCallback(async (time: number, generation: number) => {
    const player = playerRef.current;
    if (!player) return;

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return;

    try {
      await player.play(time, () => {
        if (generationRef.current !== generation) return;
        cancelAnimationFrame(rafRef.current);
        setStatus("ended");
      });
      if (generationRef.current !== generation) {
        player.stop();
        return;
      }
      setStatus("playing");
      startHighlightLoop(generation);
    } catch {
      if (generationRef.current !== generation) return;
      setStatus("error");
    }
  }, [startHighlightLoop]);

  const playFromToken = useCallback(async (tokenIndex: number) => {
    const current = trackRef.current;
    if (!current || current.aligned.length === 0) return;

    let target = tokenIndex;
    if (typeof current.aligned[target]?.start !== "number") {
      const timed = timedIndices(current.aligned);
      target = timed.find((index) => index >= tokenIndex) ?? timed[0] ?? -1;
    }
    if (target < 0 || typeof current.aligned[target].start !== "number") return;

    claimActiveVoice(ownerRef.current, stopForAnotherVoice);
    releaseAudio();
    const generation = generationRef.current;
    setSelectedIndex(target);
    setActiveWord(target);
    setStatus("loading");
    await playAt(current.aligned[target].start as number, generation);
  }, [playAt, releaseAudio, setActiveWord, setSelectedIndex, stopForAnotherVoice]);

  async function togglePlayback() {
    if (!text.trim()) return;
    if (mode === "legacy") return;

    if (!trackRef.current || !playerRef.current) {
      await loadCaptioned();
      if (captionedFailedRef.current || !trackRef.current || !playerRef.current) return;
    }

    if (status === "playing") {
      playerRef.current.pause();
      cancelAnimationFrame(rafRef.current);
      setStatus("paused");
      return;
    }
    if (status === "paused") {
      const player = playerRef.current;
      const generation = generationRef.current;
      setStatus("loading");
      await playAt(player.position(), generation);
      return;
    }
    // idle | ended | error → começa (ou recomeça) do token atual/0
    await playFromToken(status === "ended" ? 0 : selectedIndexRef.current);
  }

  function skipWords(delta: number) {
    const current = trackRef.current;
    if (!current || current.aligned.length === 0) return;
    const from = activeWordRef.current >= 0 ? activeWordRef.current : selectedIndexRef.current;
    const target = skipAlignedIndex(current.aligned, from, delta);
    if (target < 0) return;
    const token = current.aligned[target];
    if (typeof token.start !== "number") return;

    if (status === "playing") {
      void playFromToken(target);
      return;
    }
    if (status === "paused") {
      playerRef.current?.setPosition(token.start);
      setSelectedIndex(target);
      setActiveWord(target);
      return;
    }
    // idle/ended: apenas move a seleção, sem tocar.
    releaseAudio();
    setSelectedIndex(target);
    setActiveWord(target);
    if (status === "ended") setStatus("idle");
  }

  function selectToken(index: number) {
    const current = trackRef.current;
    if (!current) return;
    const token = current.aligned[index];
    if (!token || typeof token.start !== "number") return;

    setSelectedIndex(index);
    if (status === "playing") {
      void playFromToken(index);
      return;
    }
    if (status === "paused") playerRef.current?.setPosition(token.start);
    setActiveWord(index);
  }

  useEffect(() => {
    if (!preload || mode !== "word" || trackRef.current) return;
    if (!text.trim()) return;
    void loadCaptioned().catch(() => undefined);
  }, [loadCaptioned, mode, preload, text]);

  useEffect(() => () => {
    releaseAudio();
    playerRef.current?.dispose();
    playerRef.current = null;
    releaseActiveVoice(ownerRef.current);
  }, [releaseAudio]);

  if (mode === "legacy") {
    return <MessageAudioPlayer languageCode={languageCode} preload={preload} showTranscript={showTranscript} text={text} />;
  }

  const showWords = showTranscript && track !== null && track.aligned.length > 0;
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
      {showWords ? (
        <div className="chat-words">
          {track.aligned.map((token, index) => (
            <span
              className={[
                "chat-word",
                index === activeWord && (status === "playing" || status === "paused" || status === "loading") ? "active" : "",
                index === selectedIndex ? "selected" : "",
                typeof token.start !== "number" ? "muted" : ""
              ].filter(Boolean).join(" ")}
              key={index}
              onClick={() => selectToken(index)}
            >
              {token.text}{token.spaceAfter}
            </span>
          ))}
        </div>
      ) : null}
      <div className="line-player-controls word-player-controls">
        <button
          aria-label="Voltar 5 palavras"
          className="voice-icon-button"
          disabled={!track || status === "loading"}
          onClick={() => skipWords(-1)}
          type="button"
        >
          <SkipBack />
        </button>
        <button aria-label={playLabel} className="voice-icon-button" onClick={togglePlayback} title={playLabel} type="button">
          <PlayIcon className={status === "loading" ? "spin" : undefined} />
        </button>
        <button
          aria-label="Avançar 5 palavras"
          className="voice-icon-button"
          disabled={!track || status === "loading"}
          onClick={() => skipWords(1)}
          type="button"
        >
          <SkipForward />
        </button>
      </div>
    </div>
  );
}
