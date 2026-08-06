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
  tokenSegment: number[];
};

export function MessageWordPlayer({ text, languageCode, showTranscript, preload = false }: MessageWordPlayerProps) {
  const [mode, setMode] = useState<PlayerMode>("word");
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [track, setTrackState] = useState<CaptionedTrack | null>(null);
  const [activeWord, setActiveWordState] = useState(-1);
  const [selectedIndex, setSelectedIndexState] = useState(0);

  const trackRef = useRef<CaptionedTrack | null>(null);
  const activeWordRef = useRef(-1);
  const selectedIndexRef = useRef(0);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  const activeSegmentRef = useRef(-1);
  const generationRef = useRef(0);
  const ownerRef = useRef(Symbol("message-word-player"));
  const captionedFailedRef = useRef(false);
  const continuationRef = useRef<(segmentIndex: number, generation: number) => void>(() => undefined);

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
    audioRefs.current.forEach((audio) => {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    });
    audioRefs.current = [];
    activeSegmentRef.current = -1;
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

  const loadCaptioned = useCallback(async () => {
    if (captionedFailedRef.current) return;
    setStatus("loading");
    const generation = ++generationRef.current;
    try {
      const texts = segmentMessage(text);
      if (texts.length === 0) throw new Error("Empty message.");
      if (texts.some((segment) => segment.length > MAX_CAPTIONED_SEGMENT_LENGTH)) throw new Error("Message too long.");

      const segments: WordSegment[] = [];
      let offset = 0;
      for (const segmentText of texts) {
        const result = await requestCaptionedSpeech(segmentText, languageCode);
        const last = result.words[result.words.length - 1];
        segments.push({ text: segmentText, audioUrl: result.audioUrl, words: result.words, offset });
        offset += last ? last.end_time : 0;
      }
      if (generationRef.current !== generation) return;

      const aligned: AlignedToken[] = [];
      const tokenSegment: number[] = [];
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
          tokenSegment.push(segmentIndex);
        });
      });

      if (!hasUsableAlignment(aligned)) {
        // Servidor não retornou timestamps para esta voz → player legado.
        enterLegacyMode();
        return;
      }

      setTrack({ segments, aligned, tokenSegment });
      setSelectedIndex(0);
      setActiveWord(-1);
      setStatus("idle");
    } catch {
      if (generationRef.current !== generation) return;
      enterLegacyMode();
    }
  }, [enterLegacyMode, languageCode, setActiveWord, setSelectedIndex, setTrack, text]);

  const ensureAudioRef = useCallback((segmentIndex: number) => {
    const current = trackRef.current;
    if (!current) throw new Error("No captioned track.");
    const existing = audioRefs.current[segmentIndex];
    if (existing) return existing;

    const audio = new Audio(current.segments[segmentIndex].audioUrl);
    audio.preload = "auto";
    audio.ontimeupdate = () => {
      const latest = trackRef.current;
      if (!latest) return;
      const segment = activeSegmentRef.current;
      if (segment < 0 || segment >= latest.segments.length) return;
      const time = latest.segments[segment].offset + audio.currentTime;
      const index = activeIndexAtTime(latest.aligned, time);
      if (index !== activeWordRef.current) setActiveWord(index);
    };
    audio.onended = () => {
      if (audioRefs.current[segmentIndex] !== audio || activeSegmentRef.current !== segmentIndex) return;
      const generation = generationRef.current;
      const next = segmentIndex + 1;
      if (next < (trackRef.current?.segments.length ?? 0)) {
        continuationRef.current(next, generation);
      } else {
        setStatus("ended");
      }
    };
    audio.onerror = () => {
      if (audioRefs.current[segmentIndex] !== audio) return;
      setStatus("error");
    };
    audioRefs.current[segmentIndex] = audio;
    return audio;
  }, [setActiveWord]);

  const playSegment = useCallback(async (segmentIndex: number, generation: number) => {
    const current = trackRef.current;
    if (!current || segmentIndex >= current.segments.length) {
      setStatus("ended");
      return;
    }
    const audio = ensureAudioRef(segmentIndex);
    audio.currentTime = 0;
    activeSegmentRef.current = segmentIndex;
    setStatus("loading");

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return;

    try {
      await audio.play();
      if (generationRef.current !== generation) {
        audio.pause();
        return;
      }
      setStatus("playing");
    } catch {
      if (generationRef.current !== generation) return;
      setStatus("error");
    }
  }, [ensureAudioRef]);

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

    const segmentIndex = current.tokenSegment[target];
    const audio = ensureAudioRef(segmentIndex);
    const localTime = (current.aligned[target].start as number) - current.segments[segmentIndex].offset;
    audio.currentTime = Math.max(0, localTime);
    activeSegmentRef.current = segmentIndex;

    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return;

    try {
      await audio.play();
      if (generationRef.current !== generation) {
        audio.pause();
        return;
      }
      setStatus("playing");
    } catch {
      if (generationRef.current !== generation) return;
      setStatus("error");
    }
  }, [ensureAudioRef, releaseAudio, setActiveWord, setSelectedIndex, stopForAnotherVoice]);

  async function togglePlayback() {
    if (!text.trim()) return;
    if (mode === "legacy") return;

    if (!trackRef.current) {
      await loadCaptioned();
      if (captionedFailedRef.current || !trackRef.current) return;
    }

    if (status === "playing") {
      audioRefs.current[activeSegmentRef.current]?.pause();
      setStatus("paused");
      return;
    }
    if (status === "paused") {
      const audio = audioRefs.current[activeSegmentRef.current];
      if (audio) {
        try {
          await audio.play();
          setStatus("playing");
        } catch {
          void playFromToken(selectedIndexRef.current);
        }
      } else {
        await playFromToken(selectedIndexRef.current);
      }
      return;
    }
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

    const segmentIndex = current.tokenSegment[target];
    const audio = audioRefs.current[segmentIndex];
    const sameSegmentActive = status === "playing" || (status === "paused" && activeSegmentRef.current === segmentIndex && !!audio);

    if (sameSegmentActive && audio) {
      audio.currentTime = (token.start as number) - current.segments[segmentIndex].offset;
      setSelectedIndex(target);
      setActiveWord(target);
      return;
    }
    if (status === "playing") {
      void playFromToken(target);
      return;
    }
    // idle/paused (outro segmento)/ended: apenas move a seleção, sem tocar.
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
    const segmentIndex = current.tokenSegment[index];
    const audio = audioRefs.current[segmentIndex];
    if (status === "paused" && audio && activeSegmentRef.current === segmentIndex) {
      audio.currentTime = (token.start as number) - current.segments[segmentIndex].offset;
    }
    setActiveWord(index);
  }

  useEffect(() => {
    if (!preload || mode !== "word" || trackRef.current) return;
    if (!text.trim()) return;
    void loadCaptioned().catch(() => undefined);
  }, [loadCaptioned, mode, preload, text]);

  useEffect(() => {
    continuationRef.current = (segmentIndex, generation) => {
      void playSegment(segmentIndex, generation);
    };
  });

  useEffect(() => () => {
    releaseAudio();
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
