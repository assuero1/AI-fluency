import { describe, expect, it } from "vitest";
import { comboAfterAnswer, comboSoundForStreak, initialComboState } from "@/lib/client/combo-tracker";

describe("combo-tracker", () => {
  it("inicia com streak zerada", () => {
    const initial = initialComboState();
    expect(initial.streak).toBe(0);
    expect(initial.maxStreak).toBe(0);
    expect(initial.onFire).toBe(false);
    expect(initial.justBroke).toBe(false);
  });

  it("incrementa streak e maxStreak em acerto", () => {
    let state = initialComboState();
    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(1);
    expect(state.maxStreak).toBe(1);
    expect(state.onFire).toBe(false);

    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(2);
    expect(state.maxStreak).toBe(2);
  });

  it("ativa onFire a partir de 5 acertos consecutivos", () => {
    let state = initialComboState();
    for (let i = 1; i <= 4; i++) {
      state = comboAfterAnswer(state, true);
      expect(state.onFire).toBe(false);
    }
    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(5);
    expect(state.onFire).toBe(true);

    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(6);
    expect(state.onFire).toBe(true);
    expect(state.maxStreak).toBe(6);
  });

  it("reseta streak e marca justBroke em caso de erro", () => {
    let state = initialComboState();
    state = comboAfterAnswer(state, true);
    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(2);

    state = comboAfterAnswer(state, false);
    expect(state.streak).toBe(0);
    expect(state.maxStreak).toBe(2);
    expect(state.onFire).toBe(false);
    expect(state.justBroke).toBe(true);

    // Segundo erro consecutivo não marca justBroke novamente pois streak já era 0
    state = comboAfterAnswer(state, false);
    expect(state.streak).toBe(0);
    expect(state.justBroke).toBe(false);
  });

  it("seleciona o som de combo progressivo", () => {
    expect(comboSoundForStreak(0)).toBe("correct");
    expect(comboSoundForStreak(1)).toBe("combo_1");
    expect(comboSoundForStreak(2)).toBe("combo_2");
    expect(comboSoundForStreak(3)).toBe("combo_3");
    expect(comboSoundForStreak(4)).toBe("combo_4");
    expect(comboSoundForStreak(5)).toBe("combo_5");
    expect(comboSoundForStreak(10)).toBe("combo_5");
  });
});
