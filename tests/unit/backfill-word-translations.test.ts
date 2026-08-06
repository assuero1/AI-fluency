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

  it("sends words of different languages in separate single-language batches", async () => {
    const words = [
      { id: "en1", fields: { display_text: "cat", language_profile_id: "p-en" } },
      { id: "en2", fields: { display_text: "dog", language_profile_id: "p-en" } },
      { id: "es1", fields: { display_text: "gato", language_profile_id: "p-es" } }
    ];
    const translate = vi.fn(async (_env: unknown, batch: Array<{ id: string; language: string }>) =>
      Object.fromEntries(batch.map((item) => [item.id, `tr-${item.id}`]))
    );

    const translations = await translateWords({}, words, translate, { "p-en": "en", "p-es": "es" });

    expect(Object.keys(translations)).toHaveLength(3);
    expect(translate).toHaveBeenCalledTimes(2);
    const batchLanguages = translate.mock.calls.map((call) =>
      (call[1] as Array<{ language: string }>).map((item) => item.language)
    );
    expect(batchLanguages).toEqual([["en", "en"], ["es"]]);
  });

  it("prefixes the user message with Idioma when the language is known", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
      const itemsJson = body.messages[1].content.replace(/^(Idioma: .*\n)?Itens: /, "");
      const ids = (JSON.parse(itemsJson) as Array<{ id: string }>).map((item) => item.id);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(ids.map((id) => ({ id, translation: `tr-${id}` }))) } }]
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const env = { AI_BASE_URL: "https://ai.example", AI_API_KEY: "key", AI_CHAT_MODEL: "model" };
      const words = [{ id: "w1", fields: { display_text: "chat", language_profile_id: "p-fr" } }];

      await translateWords(env, words, undefined, { "p-fr": "fr" });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { messages: Array<{ content: string }> };
      expect(body.messages[1].content.startsWith("Idioma: fr\nItens: ")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("aborts the fallback after 2 consecutive failures (1 primary + 2 fallback calls for 11 words)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const words = Array.from({ length: 11 }, (_, index) => ({
      id: `w${index}`,
      fields: { display_text: `word${index}`, translation: "" }
    }));
    // Primary batch returns nothing; the fallback would need 3 batches of 5,
    // but bails out after 2 consecutive failures: 1 + 2 calls total.
    const translate = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error("provider down"));

    const translations = await translateWords({}, words, translate);

    expect(translate).toHaveBeenCalledTimes(3);
    expect(translations).toEqual({});
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
