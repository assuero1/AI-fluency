import { describe, expect, it } from "vitest";
import { clampPausedMs, computeActiveElapsedSeconds } from "../../lib/learning/chat-elapsed";

const startedAt = "2026-08-14T10:00:00.000Z";
const startedMs = new Date(startedAt).getTime();

describe("computeActiveElapsedSeconds", () => {
  it("conta os segundos decorridos sem pausas", () => {
    expect(computeActiveElapsedSeconds(startedAt, 0, startedMs + 65_000)).toBe(65);
  });

  it("desconta o tempo pausado acumulado", () => {
    expect(computeActiveElapsedSeconds(startedAt, 20_000, startedMs + 65_000)).toBe(45);
  });

  it("nunca retorna negativo", () => {
    expect(computeActiveElapsedSeconds(startedAt, 999_999, startedMs + 10_000)).toBe(0);
  });

  it("retorna 0 para data de início inválida", () => {
    expect(computeActiveElapsedSeconds("not-a-date", 0, startedMs)).toBe(0);
  });
});

describe("clampPausedMs", () => {
  it("mantém valores válidos", () => {
    expect(clampPausedMs(30_000, startedAt, startedMs + 60_000)).toBe(30_000);
  });

  it("limita ao tempo total decorrido", () => {
    expect(clampPausedMs(120_000, startedAt, startedMs + 60_000)).toBe(60_000);
  });

  it("rejeita valores inválidos", () => {
    expect(clampPausedMs(-5, startedAt, startedMs + 60_000)).toBe(0);
    expect(clampPausedMs("30000", startedAt, startedMs + 60_000)).toBe(0);
    expect(clampPausedMs(Number.NaN, startedAt, startedMs + 60_000)).toBe(0);
  });
});
