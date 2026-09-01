// tests/unit/new-words-generation.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion } = vi.hoisted(() => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({
  getTeableClient: () => ({ records: [], async listRecordsWhereAll() { return [] as never; }, async listRecordsWhere() { return [] as never; }, async createRecord(table: string, fields: Record<string, unknown>) { return { id: `${table}-x`, fields }; }, async updateRecord(_t: string, id: string, f: Record<string, unknown>) { return { id, fields: f }; }, async createEvent() {} }),
  TeableRequestError: class extends Error { status = 409; }
}));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

import { generateSentencesForWords } from "../../lib/learning/new-words";

describe("generateSentencesForWords (geração por rodadas)", () => {
  beforeEach(() => createChatCompletion.mockReset());

  it("refaz SÓ as palavras sem frases válidas na 2ª rodada", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "resposta lixo demais aqui fora", translation: "x", word: "milk" }
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "milk is good", translation: "leite é bom", word: "milk" }
      ] }) });
    const result = await generateSentencesForWords(
      [{ id: "w1", lemma: "bread" }, { id: "w2", lemma: "milk" }],
      ["eat", "good"], "Inglês", "B1"
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const secondPrompt = JSON.stringify(createChatCompletion.mock.calls[1][0]);
    expect(secondPrompt).toContain("milk");
    expect(secondPrompt).not.toContain("bread");
    expect(result.sentencesByWord.get("w1")).toHaveLength(1);
    expect(result.sentencesByWord.get("w2")).toHaveLength(1);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("escala maxTokens com o volume de frases pedidas", async () => {
    createChatCompletion.mockResolvedValue({ content: JSON.stringify({ sentences: [] }) });
    const words = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, lemma: `word${i}` }));
    await generateSentencesForWords(words, [], "Inglês", "B1");
    const options = createChatCompletion.mock.calls[0][1] as { maxTokens?: number };
    expect(options.maxTokens).toBeGreaterThan(1600);
  });

  it("mantém o piso de 1600 maxTokens para pedidos pequenos", async () => {
    createChatCompletion.mockResolvedValue({ content: JSON.stringify({ sentences: [] }) });
    await generateSentencesForWords([{ id: "w1", lemma: "bread" }], [], "Inglês", "B1");
    const options = createChatCompletion.mock.calls[0][1] as { maxTokens?: number };
    expect(options.maxTokens).toBe(1600);
  });
});
