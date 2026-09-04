let ctx: AudioContext | null = null;

export const SOUND_NAMES = [
  "button",
  "correct",
  "neutral",
  "wrong",
  "goal",
  "complete",
  "achievement",
  "combo_1",
  "combo_2",
  "combo_3",
  "combo_4",
  "combo_5"
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export type SoundNote = { frequency: number; startAt: number; duration: number; type?: OscillatorType };
export type SoundSpec = { notes: SoundNote[]; gain: number };

// Notas curtas e suaves: feedback positivo sobe, negativo desce. Ganho baixo
// de propósito — o som acompanha, nunca atrapalha.
export const SOUND_CATALOG: Record<SoundName, SoundSpec> = {
  button: { gain: 0.12, notes: [{ frequency: 880, startAt: 0, duration: 0.09, type: "sine" }] },
  correct: { gain: 0.1, notes: [
    { frequency: 659, startAt: 0, duration: 0.09, type: "triangle" },
    { frequency: 880, startAt: 0.08, duration: 0.12, type: "triangle" }
  ] },
  neutral: { gain: 0.09, notes: [{ frequency: 440, startAt: 0, duration: 0.12, type: "triangle" }] },
  wrong: { gain: 0.09, notes: [
    { frequency: 220, startAt: 0, duration: 0.14, type: "sine" },
    { frequency: 165, startAt: 0.1, duration: 0.16, type: "sine" }
  ] },
  goal: { gain: 0.11, notes: [
    { frequency: 523, startAt: 0, duration: 0.1, type: "triangle" },
    { frequency: 659, startAt: 0.09, duration: 0.1, type: "triangle" },
    { frequency: 784, startAt: 0.18, duration: 0.16, type: "triangle" }
  ] },
  complete: { gain: 0.12, notes: [
    { frequency: 523, startAt: 0, duration: 0.12, type: "triangle" },
    { frequency: 659, startAt: 0.11, duration: 0.12, type: "triangle" },
    { frequency: 784, startAt: 0.22, duration: 0.12, type: "triangle" },
    { frequency: 1046, startAt: 0.33, duration: 0.24, type: "triangle" }
  ] },
  achievement: { gain: 0.12, notes: [
    { frequency: 523, startAt: 0, duration: 0.1, type: "triangle" },
    { frequency: 659, startAt: 0.1, duration: 0.1, type: "triangle" },
    { frequency: 784, startAt: 0.2, duration: 0.1, type: "triangle" },
    { frequency: 1046, startAt: 0.3, duration: 0.14, type: "triangle" },
    { frequency: 1318, startAt: 0.42, duration: 0.22, type: "triangle" }
  ] },
  combo_1: { gain: 0.10, notes: [{ frequency: 523, startAt: 0, duration: 0.14, type: "triangle" }] },
  combo_2: { gain: 0.10, notes: [{ frequency: 587, startAt: 0, duration: 0.14, type: "triangle" }] },
  combo_3: { gain: 0.11, notes: [{ frequency: 659, startAt: 0, duration: 0.14, type: "triangle" }] },
  combo_4: { gain: 0.11, notes: [{ frequency: 784, startAt: 0, duration: 0.14, type: "triangle" }] },
  combo_5: { gain: 0.12, notes: [{ frequency: 1046, startAt: 0, duration: 0.14, type: "triangle" }] }
};

export function comboSoundName(streak: number): SoundName {
  if (streak <= 0) return "correct";
  if (streak >= 5) return "combo_5";
  return `combo_${streak}` as SoundName;
}

const SOUND_ENABLED_KEY = "ai-fluency:sound-enabled";

export function isSoundEnabled() {
  try { return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "0"; } catch { return true; }
}

export function setSoundEnabled(value: boolean) {
  try { window.localStorage.setItem(SOUND_ENABLED_KEY, value ? "1" : "0"); } catch { /* storage bloqueado */ }
}

export function playSound(name: SoundName) {
  if (!isSoundEnabled()) return;
  try {
    const spec = SOUND_CATALOG[name];
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    for (const note of spec.notes) {
      const gain = ctx.createGain();
      const start = now + note.startAt;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = note.type ?? "sine";
      osc.frequency.setValueAtTime(note.frequency, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + note.duration + 0.02);
    }
  } catch {
    // Som é cosmético: qualquer falha (ex.: AudioContext bloqueado) é silenciosa.
  }
}

/** @deprecated use playSound("button") */
export function playButtonSound() {
  playSound("button");
}
