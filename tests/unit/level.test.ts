import { describe, expect, it } from "vitest";
import { computeLevelProgress } from "@/lib/learning/level";

describe("computeLevelProgress", () => {
  it("nunca inventa percentual sem fluência medida", () => {
    const detail = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 10, avgFluency: null, xpTotal: 0 });
    expect(detail.percent).toBeGreaterThan(0);
    expect(detail.missing).toContain("Conclua uma conversa");
  });

  it("percentual cresce com consolidadas e fluência", () => {
    const low = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 10, avgFluency: 4, xpTotal: 0 });
    const high = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 40, avgFluency: 6, xpTotal: 0 });
    expect(high.percent).toBeGreaterThan(low.percent);
  });

  it("B1 com meta de Avançado cumprida reporta completo", () => {
    const detail = computeLevelProgress({ level: "Intermediário (B1)", wordsConsolidated: 150, avgFluency: 7, xpTotal: 0 });
    expect(detail.percent).toBe(100);
    expect(detail.missing).toBeNull();
  });

  it("nível desconhecido cai no estágio inicial com percentual honesto", () => {
    const detail = computeLevelProgress({ level: "Ainda não definido", wordsConsolidated: 0, avgFluency: null, xpTotal: 0 });
    expect(detail.percent).toBe(0);
  });
});
