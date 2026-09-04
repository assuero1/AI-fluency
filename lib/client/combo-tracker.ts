import { comboSoundName, type SoundName } from "./ui-sound";

export type ComboState = {
  streak: number;
  maxStreak: number;
  onFire: boolean;
  justBroke: boolean;
};

export function initialComboState(): ComboState {
  return {
    streak: 0,
    maxStreak: 0,
    onFire: false,
    justBroke: false
  };
}

export function comboAfterAnswer(state: ComboState, wasCorrect: boolean): ComboState {
  if (wasCorrect) {
    const nextStreak = state.streak + 1;
    return {
      streak: nextStreak,
      maxStreak: Math.max(state.maxStreak, nextStreak),
      onFire: nextStreak >= 5,
      justBroke: false
    };
  }

  return {
    streak: 0,
    maxStreak: state.maxStreak,
    onFire: false,
    justBroke: state.streak > 0
  };
}

export function comboSoundForStreak(streak: number): SoundName {
  return comboSoundName(streak);
}
