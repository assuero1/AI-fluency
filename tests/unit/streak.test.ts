import { describe, expect, it } from "vitest";
import { computeStreakState } from "@/lib/learning/streak";

const today = "2026-09-03";

function days(offsetsFromToday: number[]) {
  return offsetsFromToday.map((offset) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  });
}

describe("computeStreakState", () => {
  it("conta dias consecutivos incluindo hoje", () => {
    const state = computeStreakState(days([0, 1, 2]), { today, previousStreak: 0, longestStreak: 0 });
    expect(state.streak).toBe(3);
    expect(state.milestone).toBe(3);
  });

  it("hoje sem prática não quebra: conta de ontem para trás", () => {
    const state = computeStreakState(days([1, 2, 3]), { today, previousStreak: 3, longestStreak: 3 });
    expect(state.streak).toBe(3);
    expect(state.milestone).toBeNull();
  });

  it("uma falta é perdoada pelo freeze", () => {
    const state = computeStreakState(days([1, 2, 4, 5]), { today, previousStreak: 4, longestStreak: 4 });
    expect(state.streak).toBe(5);
    expect(state.freezeConsumedOn).toBe(days([3])[0]);
  });

  it("segunda falta quebra a sequência mesmo com freeze disponível", () => {
    const state = computeStreakState(days([1, 2, 5, 6]), { today, previousStreak: 2, longestStreak: 2 });
    expect(state.streak).toBe(2);
    expect(state.freezeConsumedOn).toBeNull();
  });

  it("freeze repetido em menos de 7 dias não é concedido", () => {
    const state = computeStreakState(days([1, 2, 4, 5]), { today, previousStreak: 4, longestStreak: 4, freezeUsedOn: days([2])[0] });
    expect(state.streak).toBe(2);
    expect(state.freezeConsumedOn).toBeNull();
  });

  it("marco só dispara quando é cruzado agora", () => {
    const state = computeStreakState(days([0, 1, 2, 3, 4, 5, 6]), { today, previousStreak: 6, longestStreak: 6 });
    expect(state.streak).toBe(7);
    expect(state.milestone).toBe(7);
    const again = computeStreakState(days([0, 1, 2, 3, 4, 5, 6]), { today, previousStreak: 7, longestStreak: 7 });
    expect(again.milestone).toBeNull();
  });

  it("sem nenhum dia ativo a sequência é zero", () => {
    const state = computeStreakState([], { today, previousStreak: 5, longestStreak: 5 });
    expect(state.streak).toBe(0);
    expect(state.milestone).toBeNull();
  });
});
