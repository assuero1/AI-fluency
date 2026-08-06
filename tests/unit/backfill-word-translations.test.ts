import { describe, expect, it, vi } from "vitest";
import { chunkItems, parseTranslationItems, translateWords, wordsMissingTranslation } from "../../scripts/backfill-word-translations.mjs";

describe("backfill-word-translations", () => {
  it("selects only words with empty or missing translations", () => {
    const records = [
      { id: "a", fields: { lemma: "house", translation: "casa" } },
      { id: "b", fields: { lemma: "work", translation: "" } },
      { id: "c", fields: { lemma: "gone" } },
      { id: "d", fields: { lemma: "run", translation: "  " } }
    ];

    expect(wordsMissingTranslation(records).map((record) => record.id)).toEqual(["b", "c", "d"]);
  });

  it("splits items into fixed-size chunks", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([], 5)).toEqual([]);
  });

  it("parses only known ids with non-empty translations", () => {
    const content = 'texto antes [{"id":"a","translation":"casa"},{"id":"b","translation":""},{"id":"x","translation":"foo"}] depois';

    expect(parseTranslationItems(content, new Set(["a", "b"]))).toEqual({ a: "casa" });
    expect(parseTranslationItems("not json", new Set(["a"]))).toEqual({});
  });

  it("falls back to small batches for words left without translation", async () => {
    const words = Array.from({ length: 21 }, (_, index) => ({
      id: `w${index}`,
      fields: { display_text: `word${index}`, translation: "" }
    }));
    const translate = vi.fn(async (_env: unknown, batch: Array<{ id: string }>) =>
      batch.length > 5 ? {} : Object.fromEntries(batch.map((item) => [item.id, `tr-${item.id}`]))
    );

    const translations = await translateWords({}, words, translate);

    expect(translate.mock.calls[0][1]).toHaveLength(20);
    expect(translate.mock.calls[1][1]).toHaveLength(1);
    const fallbackCalls = translate.mock.calls.slice(2);
    expect(fallbackCalls.every((call) => (call[1] as unknown[]).length <= 5)).toBe(true);
    expect(Object.keys(translations)).toHaveLength(21);
    expect(translations.w0).toBe("tr-w0");
  });
});
