import { describe, expect, it } from "vitest";
import { cardTypeWeights, chooseCardTypes, countPlannedTypes } from "../../lib/learning/flashcard-type-selection";

const FLAGS_ON = { production: true, cloze: true, listening: true };

function word(id: string, reviewState?: string) {
  return { id, fields: { review_state: reviewState } };
}

describe("cardTypeWeights", () => {
  it("gives new/learning words 70% comprehension and 30% cloze", () => {
    for (const state of ["new", "learning", undefined]) {
      expect(cardTypeWeights(state, { audioEnabled: true, flags: FLAGS_ON })).toEqual({
        target_to_native: 0.7,
        native_to_target: 0,
        cloze: 0.3,
        listening: 0
      });
    }
  });

  it("gives review words the full mix", () => {
    expect(cardTypeWeights("review", { audioEnabled: true, flags: FLAGS_ON })).toEqual({
      native_to_target: 0.4,
      target_to_native: 0.25,
      cloze: 0.2,
      listening: 0.15
    });
  });

  it("gives difficult words maximum variety", () => {
    expect(cardTypeWeights("difficult", { audioEnabled: true, flags: FLAGS_ON })).toEqual({
      target_to_native: 0.25,
      native_to_target: 0.25,
      cloze: 0.25,
      listening: 0.25
    });
  });

  it("redistributes listening weight when audio is disabled", () => {
    expect(cardTypeWeights("review", { audioEnabled: false, flags: FLAGS_ON })).toEqual({
      native_to_target: 0.475,
      target_to_native: 0.325,
      cloze: 0.2,
      listening: 0
    });
    expect(cardTypeWeights("difficult", { audioEnabled: false, flags: FLAGS_ON }).listening).toBe(0);
  });

  it("routes a disabled type's weight to comprehension", () => {
    const weights = cardTypeWeights("review", { audioEnabled: true, flags: { production: false, cloze: true, listening: true } });
    expect(weights.native_to_target).toBe(0);
    expect(weights.target_to_native).toBeCloseTo(0.65, 10);
    const noCloze = cardTypeWeights("new", { audioEnabled: true, flags: { production: true, cloze: false, listening: true } });
    expect(noCloze.cloze).toBe(0);
    expect(noCloze.target_to_native).toBe(1);
  });
});

describe("chooseCardTypes", () => {
  it("is deterministic per word and seed", () => {
    const words = [word("a", "review"), word("b", "review"), word("c", "new")];
    const options = { seed: "deck-1", audioEnabled: true, flags: FLAGS_ON };
    const first = chooseCardTypes(words, options);
    expect(chooseCardTypes(words, options)).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("never picks listening when audio is disabled", () => {
    const words = Array.from({ length: 40 }, (_, index) => word(`w${index}`, "difficult"));
    const types = chooseCardTypes(words, { seed: "s", audioEnabled: false, flags: FLAGS_ON });
    expect(types).not.toContain("listening");
  });

  it("never picks a flag-disabled type", () => {
    const words = Array.from({ length: 40 }, (_, index) => word(`w${index}`, "review"));
    const types = chooseCardTypes(words, { seed: "s", audioEnabled: true, flags: { production: true, cloze: false, listening: false } });
    expect(types).not.toContain("cloze");
    expect(types).not.toContain("listening");
  });

  it("spreads types across a large difficult deck (sanity, not exact ratio)", () => {
    const words = Array.from({ length: 80 }, (_, index) => word(`w${index}`, "difficult"));
    const types = chooseCardTypes(words, { seed: "spread", audioEnabled: true, flags: FLAGS_ON });
    const counts = countPlannedTypes(types);
    expect(counts.nativeToTarget).toBeGreaterThan(5);
    expect(counts.cloze).toBeGreaterThan(5);
    expect(counts.listening).toBeGreaterThan(5);
    expect(counts.targetToNative).toBeGreaterThan(5);
  });

  it("follows the review_state of the sense passed for each word, not a word-level cache", () => {
    // The flashcard session passes per-sense entries ({ id: wordId, fields: { review_state: senseState } });
    // the roll stays keyed by word id, but the weights must come from the sense state.
    const ids = Array.from({ length: 60 }, (_, index) => `w${index}`);
    const options = { seed: "sense-mix", audioEnabled: true, flags: FLAGS_ON };
    const asNew = chooseCardTypes(ids.map((id) => ({ id, fields: { review_state: "new" } })), options);
    expect(asNew).not.toContain("native_to_target");
    expect(asNew).not.toContain("listening");
    const asReview = chooseCardTypes(ids.map((id) => ({ id, fields: { review_state: "review" } })), options);
    expect(asReview).toContain("native_to_target");
    expect(asReview).toContain("listening");
  });
});

describe("countPlannedTypes", () => {
  it("counts each type", () => {
    expect(countPlannedTypes(["target_to_native", "cloze", "cloze", "listening", "native_to_target"])).toEqual({
      targetToNative: 1,
      nativeToTarget: 1,
      cloze: 2,
      listening: 1
    });
  });
});
