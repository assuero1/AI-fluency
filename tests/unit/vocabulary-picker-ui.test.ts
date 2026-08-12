import { describe, expect, it } from "vitest";
import { formatSavedWordMeta } from "../../lib/learning/vocabulary-picker-ui";

describe("formatSavedWordMeta", () => {
  it("shows per-sense usage counts when the word has senses", () => {
    const meta = formatSavedWordMeta(
      { id: "word-1", fields: { translation: "banco", total_uses: 5 } },
      [
        { wordId: "word-1", translation: "banco", isPrimary: true, totalUses: 4 },
        { wordId: "word-1", translation: "margem", isPrimary: false, totalUses: 1 }
      ]
    );

    expect(meta).toBe("banco · usada 4x · margem · usada 1x");
  });

  it("falls back to the word translation when there are no senses", () => {
    expect(formatSavedWordMeta({ id: "word-1", fields: { translation: "casa", total_uses: 2 } }, [])).toBe("casa");
  });

  it("falls back to the word-level usage count without translation or senses", () => {
    expect(formatSavedWordMeta({ id: "word-1", fields: { translation: "", total_uses: 3 } }, [])).toBe("usada 3 vez(es)");
  });
});
