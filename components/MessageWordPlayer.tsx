"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TalkitoIcon, type TalkitoIconName } from "./TalkitoIcon";
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
import { buildSeamlessTrack, type SeamlessTrack } from "@/lib/learning/seamless-audio";
import { msUntilAudioRouteRestored } from "@/lib/learning/speech";
import {
  claimActiveVoice,
  createStallTracker,
  releaseActiveVoice,
  reportVoiceFailure,
  requestCaptionedSpeech,
  samplePlaybackStall,
  unlockAudioForPlayback,
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

const PLAY_RETRY_DELAY_MS = 300;

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
  const statusRef = useRef<PlayerStatus>("idle");
  const activeWordRef = useRef(-1);
  const selectedIndexRef = useRef(0);
  const seamlessRef = useRef<SeamlessTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const generationRef = useRef(0); // invalida callbacks antigos
  const ownerRef = useRef(Symbol("message-word-player"));
  const captionedFailedRef = useRef(false);
  const unlockedRef = useRef(false);
  const unlockHandleRef = useRef<{ cancel: () => void } | null>(null);
  const stallTrackerRef = useRef(createStallTracker());

  const setStatusTracked = useCallback((next: PlayerStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

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
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const stopForAnotherVoice = useCallback(() => {
    releaseAudio();
    setStatusTracked("idle");
    setSelectedIndex(0);
    setActiveWord(-1);
  }, [releaseAudio, setActiveWord, setSelectedIndex, setStatusTracked]);

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

  /** Destrava o <audio> no gesto do usuário (iOS) — chamada nos handlers de toque. */
  const unlockInGesture = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    unlockHandleRef.current = unlockAudioForPlayback(ensureAudioElement());
  }, [ensureAudioElement]);

  const enterLegacyMode = useCallback(() => {
    captionedFailedRef.current = true;
    releaseAudio();
    setStatusTracked("idle");
    setMode("legacy");
  }, [releaseAudio, setStatusTracked]);

  /** O watchdog esgotou as recuperações do episódio: nem re-seek + play()
   * revive o elemento — declara erro como nos demais caminhos de falha. */
  const giveUpStalledPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    reportVoiceFailure(text, languageCode, "playback stalled with no progress");
    setStatusTracked("error");
  }, [languageCode, setStatusTracked, text]);

  const startHighlightLoop = useCallback((generation: number) => {
    stallTrackerRef.current = createStallTracker();
    const step = () => {
      if (generationRef.current !== generation) return;
      const audio = audioRef.current;
      const current = trackRef.current;
      if (!audio || !current) return;
      const index = activeIndexAtTime(current.aligned, audio.currentTime);
      if (index !== activeWordRef.current) setActiveWord(index);
      samplePlaybackStall(audio, stallTrackerRef.current, statusRef.current === "playing", giveUpStalledPlayback);
      rafRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [giveUpStalledPlayback, setActiveWord]);

  const loadCaptionedTask = useCallback(async () => {
    if (captionedFailedRef.current) return;
    setStatusTracked("loading");
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
        reportVoiceFailure(text, languageCode, "captioned alignment unusable, entering legacy mode");
        enterLegacyMode();
        return;
      }

      let audioUrl: string;
      if (segments.length === 1) {
        // Caso comum (mensagens até 1200 chars): o MP3 único toca direto no
        // <audio>, sem decodificar/reempacotar WAV — o primeiro som sai antes.
        audioUrl = segments[0].audioUrl;
      } else {
        // Monta UM WAV contínuo com todos os segmentos: a bolha toca como um
        // áudio único num <audio> nativo, sem gap entre as partes.
        try {
          const seamless = await buildSeamlessTrack(segments.map((segment) => segment.audioUrl));
          if (generationRef.current !== generation) {
            seamless.dispose();
            return;
          }
          seamless.partOffsets.forEach((offset, segmentIndex) => {
            if (segments[segmentIndex]) segments[segmentIndex].offset = offset;
          });
          seamlessRef.current?.dispose();
          seamlessRef.current = seamless;
          audioUrl = seamless.audioUrl;
        } catch {
          // Se buildSeamlessTrack falhar (ex.: decodeAudioData não suporta Opus no Safari),
          // faz fallback gracioso: toca o primeiro áudio direto no <audio>
          // preservando o alinhamento de palavras em vez de descartar tudo para o modo legado.
          audioUrl = segments[0].audioUrl;
        }
      }

      const audio = ensureAudioElement();
      audio.src = audioUrl;

      setTrack({ segments, aligned: buildTrackAlignment(segments) });
      setSelectedIndex(0);
      setActiveWord(-1);
      setStatusTracked("idle");
    } catch (err) {
      if (generationRef.current !== generation) return;
      reportVoiceFailure(text, languageCode, `loadCaptionedTask failed: ${err instanceof Error ? err.message : String(err)}`);
      enterLegacyMode();
    }
  }, [ensureAudioElement, enterLegacyMode, languageCode, setActiveWord, setSelectedIndex, setStatusTracked, setTrack, text]);

  // Preload e o primeiro play podem disparar juntos; sem a promise
  // compartilhada cada um montaria a faixa (downloads + decode) em duplicidade.
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const loadCaptioned = useCallback(() => {
    const existing = loadPromiseRef.current;
    if (existing) return existing;
    const task = loadCaptionedTask().finally(() => {
      if (loadPromiseRef.current === task) loadPromiseRef.current = null;
    });
    loadPromiseRef.current = task;
    return task;
  }, [loadCaptionedTask]);

  /** Toca a faixa a partir de `time` segundos (posição absoluta no WAV). */
  const playAt = useCallback(async (time: number, generation: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // O destravamento do gesto não pode pausar o play real nem deixá-lo mudo.
    unlockHandleRef.current?.cancel();
    audio.muted = false;

    // iOS: aguarda a AVAudioSession restaurar a rota do alto-falante.
    const wait = msUntilAudioRouteRestored();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (generationRef.current !== generation) return;

    // Uma segunda tentativa cobre rejeições transitórias do iOS (sessão de
    // áudio ainda restaurando a rota depois do microfone).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        audio.currentTime = time;
        await audio.play();
        if (generationRef.current !== generation) {
          audio.pause();
          return;
        }
        setStatusTracked("playing");
        startHighlightLoop(generation);
        return;
      } catch {
        if (generationRef.current !== generation) return;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, PLAY_RETRY_DELAY_MS));
      }
    }
    if (generationRef.current !== generation) return;
    reportVoiceFailure(text, languageCode, "audio.play() rejected");
    setStatusTracked("error");
  }, [languageCode, setStatusTracked, startHighlightLoop, text]);

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
    unlockInGesture();
    const generation = generationRef.current;
    setSelectedIndex(target);
    setActiveWord(target);
    setStatusTracked("loading");
    await playAt(current.aligned[target].start as number, generation);
  }, [playAt, releaseAudio, setActiveWord, setSelectedIndex, setStatusTracked, stopForAnotherVoice, unlockInGesture]);

  async function togglePlayback() {
    if (!text.trim()) return;
    if (mode === "legacy") return;

    // iOS: destrava o <audio> ainda no gesto do usuário — sem isso o play()
    // depois dos awaits de rede perde a "user activation" e é rejeitado.
    unlockInGesture();

    if (!trackRef.current) {
      await loadCaptioned();
      if (captionedFailedRef.current || !trackRef.current) return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (statusRef.current === "playing") {
      audio.pause();
      cancelAnimationFrame(rafRef.current);
      setStatusTracked("paused");
      return;
    }
    if (statusRef.current === "paused") {
      const generation = generationRef.current;
      setStatusTracked("loading");
      await playAt(audio.currentTime, generation);
      return;
    }
    // idle | ended | error → começa (ou recomeça) do token atual/0
    await playFromToken(statusRef.current === "ended" ? 0 : selectedIndexRef.current);
  }

  function skipWords(delta: number) {
    const current = trackRef.current;
    if (!current || current.aligned.length === 0) return;
    const from = activeWordRef.current >= 0 ? activeWordRef.current : selectedIndexRef.current;
    const target = skipAlignedIndex(current.aligned, from, delta);
    if (target < 0) return;
    const token = current.aligned[target];
    if (typeof token.start !== "number") return;

    if (statusRef.current === "playing") {
      void playFromToken(target);
      return;
    }
    if (statusRef.current === "paused" && audioRef.current) {
      audioRef.current.currentTime = token.start;
      setSelectedIndex(target);
      setActiveWord(target);
      return;
    }
    // idle/ended: apenas move a seleção, sem tocar.
    releaseAudio();
    setSelectedIndex(target);
    setActiveWord(target);
    if (statusRef.current === "ended") setStatusTracked("idle");
  }

  function selectToken(index: number) {
    const current = trackRef.current;
    if (!current) return;
    const token = current.aligned[index];
    if (!token || typeof token.start !== "number") return;

    setSelectedIndex(index);
    if (statusRef.current === "playing") {
      void playFromToken(index);
      return;
    }
    if (statusRef.current === "paused" && audioRef.current) audioRef.current.currentTime = token.start;
    setActiveWord(index);
  }

  useEffect(() => {
    if (!preload || mode !== "word" || trackRef.current) return;
    if (!text.trim()) return;
    void loadCaptioned().catch(() => undefined);
  }, [loadCaptioned, mode, preload, text]);

  useEffect(() => () => {
    releaseAudio();
    seamlessRef.current?.dispose();
    seamlessRef.current = null;
    audioRef.current = null;
    releaseActiveVoice(ownerRef.current);
  }, [releaseAudio]);

  if (mode === "legacy") {
    return <MessageAudioPlayer languageCode={languageCode} preload={preload} showTranscript={showTranscript} text={text} />;
  }

  const showWords = showTranscript && track !== null && track.aligned.length > 0;
  const playIconName: TalkitoIconName =
    status === "loading"
      ? "loader"
      : status === "playing"
        ? "pause"
        : status === "ended"
          ? "rotate-ccw"
          : "play";
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
      ) : showTranscript || status === "error" ? (
        // Texto visível desde já: vira tokens destacáveis quando o áudio
        // terminar de carregar, em vez de deixar a bolha vazia até lá.
        // No erro, o texto aparece MESMO com transcrição desligada — sem isso
        // o usuário ficaria sem ler a mensagem de jeito nenhum.
        <div className="chat-words">{text}</div>
      ) : null}
      {status === "error" ? (
        <p className="chat-audio-error-note" role="status">Áudio indisponível agora — leia a mensagem acima.</p>
      ) : null}
      <div className="line-player-controls word-player-controls">
        <button
          aria-label="Voltar 5 palavras"
          className="voice-icon-button"
          disabled={!track || status === "loading"}
          onClick={() => skipWords(-1)}
          type="button"
        >
          <TalkitoIcon name="skip-back" size={20} />
        </button>
        <button
          aria-label={playLabel}
          className={status === "error" ? "voice-icon-button audio-error" : "voice-icon-button"}
          onClick={togglePlayback}
          title={playLabel}
          type="button"
        >
          <TalkitoIcon name={playIconName} size={20} />
        </button>
        <button
          aria-label="Avançar 5 palavras"
          className="voice-icon-button"
          disabled={!track || status === "loading"}
          onClick={() => skipWords(1)}
          type="button"
        >
          <TalkitoIcon name="skip-forward" size={20} />
        </button>
      </div>
    </div>
  );
}
