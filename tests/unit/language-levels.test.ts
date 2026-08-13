import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE_LEVEL, isLanguageLevel, LANGUAGE_LEVELS } from "../../lib/learning/levels";

describe("language levels", () => {
  it("lists exactly the supported levels with B1 as default", () => {
    expect(LANGUAGE_LEVELS).toEqual(["Iniciante", "Intermediário (B1)", "Avançado"]);
    expect(DEFAULT_LANGUAGE_LEVEL).toBe("Intermediário (B1)");
  });

  it("accepts only the supported levels", () => {
    expect(isLanguageLevel("Iniciante")).toBe(true);
    expect(isLanguageLevel("Intermediário (B1)")).toBe(true);
    expect(isLanguageLevel("Avançado")).toBe(true);
    expect(isLanguageLevel("Expert")).toBe(false);
    expect(isLanguageLevel("")).toBe(false);
    expect(isLanguageLevel(undefined)).toBe(false);
    expect(isLanguageLevel(42)).toBe(false);
  });
});
