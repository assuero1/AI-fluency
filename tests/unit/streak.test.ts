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

describe("computeStreakState — dia congelado adquirido", () => {
  const today = "2026-09-03";
  const day = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  };

  it("mantém a streak estável em sincronizações seguintes ao freeze", () => {
    // Praticou 01 e 03; 02 foi congelado na sincronização anterior.
    const activeDays = [day(2), day(0)];
    const again = computeStreakState(activeDays, { today, previousStreak: 3, longestStreak: 3, freezeUsedOn: day(1) });
    expect(again.streak).toBe(2 + 1); // 03 + 02 congelado; 01 continua ativo
    expect(again.streak).toBe(3);
    expect(again.freezeConsumedOn).toBeNull();
  });

  it("dia congelado não concede freeze novo em cadeia", () => {
    const activeDays = [day(2), day(5), day(6)];
    const state = computeStreakState(activeDays, { today, previousStreak: 3, longestStreak: 3, freezeUsedOn: day(1) });
    // 03 ✓, 02 congelado ✓, 01 ✗ e freeze em cooldown → para em 2.
    expect(state.streak).toBe(2);
  });
});

describe("computeStreakState — normalização da coluna DATE", () => {
  const today = "2026-09-03";
  const day = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  };

  it("freeze serializado como timestamptz ainda conta o dia adquirido", () => {
    const state = computeStreakState([day(0), day(2)], { today, previousStreak: 3, longestStreak: 3, freezeUsedOn: `${day(1)}T00:00:00+00:00` });
    expect(state.streak).toBe(3);
    expect(state.freezeConsumedOn).toBeNull();
  });

  it("cooldown de 7 dias funciona com a forma serializada", () => {
    // Praticou 03 e 01; falta 02.
    const activeDays = [day(0), day(2)];
    // Freeze usado há 3 dias: dentro do cooldown → a falta de 02 quebra.
    const inCooldown = computeStreakState(activeDays, { today, previousStreak: 1, longestStreak: 1, freezeUsedOn: `${day(3)}T00:00:00+00:00` });
    expect(inCooldown.streak).toBe(1);
    // Freeze usado há 8 dias: cooldown expirou → 02 é perdoada, streak = 3.
    const expired = computeStreakState(activeDays, { today, previousStreak: 1, longestStreak: 1, freezeUsedOn: `${day(8)}T00:00:00+00:00` });
    expect(expired.streak).toBe(3);
    expect(expired.freezeConsumedOn).toBe(day(1));
  });
});
