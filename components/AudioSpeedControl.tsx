"use client";

import { useSyncExternalStore } from "react";
import { getAudioRate, LEARNING_AUDIO_RATE, setAudioRate, subscribeAudioRate } from "@/lib/learning/audio-policy";

export function useAudioRate() {
  return useSyncExternalStore(subscribeAudioRate, getAudioRate, () => LEARNING_AUDIO_RATE);
}

export function AudioSpeedControl() {
  const rate = useAudioRate();
  return (
    <select aria-label="Velocidade do áudio" className="audio-speed-control" value={rate} onChange={(event) => setAudioRate(Number(event.target.value))}>
      <option value={0.75}>0,75× · Lento</option>
      <option value={0.85}>0,85× · Aprendizado</option>
      <option value={1}>1× · Normal</option>
    </select>
  );
}
