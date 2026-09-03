import { describe, expect, it } from "vitest";
import { chartPoints } from "@/lib/learning/charts";

describe("chartPoints", () => {
  it("mapeia mínimo→baixo e máximo→topo", () => {
    const points = chartPoints([0, 10], 100, 50);
    expect(points).toBe("0,50 100,0");
  });

  it("um único valor rende linha no meio", () => {
    expect(chartPoints([7], 100, 50)).toBe("0,25 100,25");
  });

  it("sem valores devolve string vazia", () => {
    expect(chartPoints([], 100, 50)).toBe("");
  });

  it("valores iguais rendem linha plana no meio", () => {
    expect(chartPoints([5, 5, 5], 100, 50)).toBe("0,25 50,25 100,25");
  });
});
