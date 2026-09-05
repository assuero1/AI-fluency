/** Taxas absolutas de reprodução; não alteram a identidade do áudio gerado. */
export const LEARNING_AUDIO_RATE = 0.85;
export const AUDIO_RATES = [0.75, LEARNING_AUDIO_RATE, 1] as const;
const STORAGE_KEY = "ai-fluency.audio-rate.v1";
const listeners = new Set<() => void>();
let memoryRate = LEARNING_AUDIO_RATE;

export function getAudioRate() {
  if (typeof window === "undefined") return LEARNING_AUDIO_RATE;
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (AUDIO_RATES.some((rate) => rate === saved)) memoryRate = saved;
  } catch { /* Armazenamento pode estar indisponível no modo privado. */ }
  return memoryRate;
}

export function setAudioRate(rate: number) {
  if (!AUDIO_RATES.some((allowed) => allowed === rate)) return;
  memoryRate = rate;
  try { window.localStorage.setItem(STORAGE_KEY, String(rate)); } catch { /* Preferência permanece nesta página. */ }
  listeners.forEach((listener) => listener());
}

export function subscribeAudioRate(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function applyAudioRate(audio: HTMLMediaElement, rate = getAudioRate()) {
  audio.preservesPitch = true;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
}
