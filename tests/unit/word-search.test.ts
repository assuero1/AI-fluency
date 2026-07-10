import { describe, expect, it } from "vitest";
import { matchesWordSearch, normalizeWordSearchQuery } from "../../lib/learning/words";

const word = { displayText: "Café", lemma: "café", translation: "coffee" };

describe("word search", () => {
  it("matches accents and either learning language", () => {
    expect(matchesWordSearch(word, "cafe")).toBe(true);
    expect(matchesWordSearch(word, "COFFEE")).toBe(true);
  });

  it("normalizes and limits query length", () => {
    expect(normalizeWordSearchQuery("  CAFÉ  ")).toBe("cafe");
    expect(normalizeWordSearchQuery("a".repeat(120))).toHaveLength(80);
  });
});
