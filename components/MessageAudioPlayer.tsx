"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { activeIndexAtTime, skipAlignedIndex } from "@/lib/learning/captions";
import { splitIntoSentences } from "@/lib/learning/sentences";
import { ProgressiveAudio, type PlaybackState } from "@/lib/learning/progressive-audio";
import { applyAudioRate } from "@/lib/learning/audio-policy";
import { reportVoiceFailure, requestCaptionedSpeech } from "./voice-shared";
import { AudioSpeedControl, useAudioRate } from "./AudioSpeedControl";

export type MessageAudioPlayerProps = {
  text: string;
  languageCode?: string;
  showTranscript: boolean;
  preload?: boolean;
};

export function MessageAudioPlayer(props: MessageAudioPlayerProps) {
  // Uma nova identidade invalida a reprodução e callbacks do texto anterior.
  return <SentencePlayer key={`${props.languageCode ?? ""}\n${props.text}`} {...props} />;
}

function SentencePlayer({ text, languageCode, showTranscript, preload = false }: MessageAudioPlayerProps) {
  const lines = useMemo(() => splitIntoSentences(text), [text]);
  const [state, setState] = useState<PlaybackState>({ status: "idle", index: 0, aligned: [], time: 0 });
  const player = useRef<ProgressiveAudio | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rate = useAudioRate();

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const controller = new ProgressiveAudio({
      texts: lines,
      audio,
      request: (sentence, refresh) => requestCaptionedSpeech(sentence, languageCode, refresh),
      onError: (reason) => reportVoiceFailure(text, languageCode, reason),
      onState: (next) => setState((previous) => {
        // O relógio roda sem renderizar React a cada frame; só a palavra ativa muda a UI.
        if (previous.status === next.status && previous.index === next.index && previous.aligned === next.aligned &&
          activeIndexAtTime(previous.aligned, previous.time) === activeIndexAtTime(next.aligned, next.time)) return previous;
        return next;
      })
    });
    player.current = controller;
    // Mensagens antigas são preparadas quando o usuário demonstra intenção.
    return () => { controller.dispose(); player.current = null; audioRef.current = null; };
  }, [languageCode, lines, text]);

  useEffect(() => {
    if (preload) void player.current?.preload();
  }, [preload]);

  useEffect(() => {
    if (audioRef.current) applyAudioRate(audioRef.current, rate);
  }, [rate]);

  useEffect(() => {
    if (state.status !== "playing") return;
    let frame = 0;
    const tick = () => { player.current?.tick(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.status]);

  const activeWord = activeIndexAtTime(state.aligned, state.time);
  const busy = state.status === "loading" || state.status === "buffering";
  const active = state.status === "playing" || state.status === "paused" || busy;
  const hasWords = state.aligned.length > 0;
  const skip = (delta: number) => {
    if (hasWords) {
      const target = skipAlignedIndex(state.aligned, activeWord, delta);
      const time = state.aligned[target]?.start;
      if (target !== activeWord && time !== undefined) { player.current?.seek(state.index, time); return; }
    }
    player.current?.seek(Math.max(0, Math.min(lines.length - 1, state.index + delta)));
  };
  const label = busy ? "Pausar carregamento" : state.status === "playing" ? "Pausar áudio" :
    state.status === "paused" ? "Continuar áudio" : state.status === "ended" ? "Ouvir novamente" :
    state.status === "error" ? "Voz indisponível. Tentar novamente" : "Ouvir mensagem";

  return (
    <div className="message-audio-player" onPointerEnter={() => { if (state.status === "idle") void player.current?.preload(); }} onFocus={() => { if (state.status === "idle") void player.current?.preload(); }}>
      {showTranscript || state.status === "error" ? (
        <div className="chat-lines">
          {lines.map((line, index) => (
            <span className={`chat-line${index === state.index && active && !hasWords ? " active" : ""}`} key={index}>
              {index === state.index && hasWords ? state.aligned.map((token, tokenIndex) => (
                <span key={tokenIndex}>
                  {token.start !== undefined ? (
                    <button type="button" className={`chat-word audio-word-button${tokenIndex === activeWord && active ? " active" : ""}`} onClick={() => player.current?.seek(index, token.start)} aria-label={`Ouvir a partir de ${token.text}`}>
                      {token.text}
                    </button>
                  ) : token.text}{token.spaceAfter}
                </span>
              )) : line}
            </span>
          ))}
        </div>
      ) : null}
      {state.status === "error" ? <p className="chat-audio-error-note" role="status">Áudio indisponível agora — leia a mensagem acima.</p> : null}
      <div className="line-player-controls">
        <button aria-label={hasWords ? "Voltar 5 palavras" : "Voltar uma frase"} className="voice-icon-button" disabled={busy || (!hasWords && lines.length < 2)} onClick={() => skip(-1)} type="button"><SkipBack aria-hidden="true" size={20} /></button>
        <button aria-label={label} className={`voice-icon-button${state.status === "error" ? " audio-error" : ""}`} disabled={!lines.length} onClick={() => player.current?.toggle()} title={label} type="button">
          {busy ? <span className="audio-waveform-loader" aria-hidden="true"><span className="audio-wave-bar" /><span className="audio-wave-bar" /><span className="audio-wave-bar" /></span> : state.status === "playing" ? <Pause aria-hidden="true" size={20} /> : state.status === "ended" ? <RotateCcw aria-hidden="true" size={20} /> : <Play aria-hidden="true" size={20} />}
        </button>
        <button aria-label={hasWords ? "Avançar 5 palavras" : "Avançar uma frase"} className="voice-icon-button" disabled={busy || (!hasWords && lines.length < 2)} onClick={() => skip(1)} type="button"><SkipForward aria-hidden="true" size={20} /></button>
        <AudioSpeedControl />
      </div>
    </div>
  );
}
