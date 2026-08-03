import type { FlashcardType } from "./flashcard-contracts";
import { hashSeed } from "./spaced-repetition";

export type CardTypeFlags = { production: boolean; cloze: boolean; listening: boolean };

const ALL_TYPES: FlashcardType[] = ["target_to_native", "native_to_target", "cloze", "listening"];

// Weights are plain decimal fractions; redistribution math (e.g. 0.4 + 0.15 / 2)
// would otherwise leave IEEE-754 residue like 0.47500000000000003.
const exact = (value: number) => Math.round(value * 1e10) / 1e10;

// Type weights per learning stage (spec section 4). Listening requires audio;
// a flag-disabled type's weight goes to comprehension (target_to_native).
export function cardTypeWeights(
  reviewState: string | undefined,
  options: { audioEnabled: boolean; flags: CardTypeFlags }
): Record<FlashcardType, number> {
  const base: Record<FlashcardType, number> = reviewState === "difficult"
    ? { target_to_native: 0.25, native_to_target: 0.25, cloze: 0.25, listening: 0.25 }
    : reviewState === "review" || reviewState === "suspended"
      ? { target_to_native: 0.25, native_to_target: 0.4, cloze: 0.2, listening: 0.15 }
      : { target_to_native: 0.7, native_to_target: 0, cloze: 0.3, listening: 0 };
  if (!options.audioEnabled) {
    base.native_to_target = exact(base.native_to_target + base.listening / 2);
    base.target_to_native = exact(base.target_to_native + base.listening / 2);
    base.listening = 0;
  }
  const disabled: Partial<Record<FlashcardType, boolean>> = {
    native_to_target: !options.flags.production,
    cloze: !options.flags.cloze,
    listening: !options.flags.listening
  };
  for (const type of ALL_TYPES) {
    if (disabled[type] && base[type] > 0) {
      base.target_to_native = exact(base.target_to_native + base[type]);
      base[type] = 0;
    }
  }
  return base;
}

// Deterministic per word: same deck seed → same assignment.
export function chooseCardTypes<T extends { id: string; fields: { review_state?: string } }>(
  words: T[],
  options: { seed: string; audioEnabled: boolean; flags: CardTypeFlags }
): FlashcardType[] {
  return words.map((word) => {
    const weights = cardTypeWeights(word.fields.review_state, options);
    const roll = (hashSeed(`${options.seed}:${word.id}`) % 10_000) / 10_000;
    let cumulative = 0;
    for (const type of ALL_TYPES) {
      cumulative += weights[type];
      if (roll < cumulative) return type;
    }
    return "target_to_native";
  });
}

export function countPlannedTypes(types: FlashcardType[]) {
  return {
    targetToNative: types.filter((type) => type === "target_to_native").length,
    nativeToTarget: types.filter((type) => type === "native_to_target").length,
    cloze: types.filter((type) => type === "cloze").length,
    listening: types.filter((type) => type === "listening").length
  };
}
