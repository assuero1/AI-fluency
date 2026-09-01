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

const messagesOf = (callIndex: number) => createChatCompletion.mock.calls[callIndex][0] as Array<{ role: string; content: string }>;
const userContent = (callIndex: number) => messagesOf(callIndex).find((message) => message.role === "user")?.content ?? "";
const systemContent = (callIndex: number) => messagesOf(callIndex).find((message) => message.role === "system")?.content ?? "";
const sentence = (text: string, word: string) => ({ text, translation: `tradução: ${text}`, word });

// Palavras de conteúdo cobertas pelo "vocabulário conhecido" para as frases passarem na validação.
const KNOWN = ["bright", "warm", "high", "white", "round", "pale", "big", "near", "soft", "golden", "hot", "quiet", "huge", "old"];

describe("generateSentencesForWords (geração por rodadas)", () => {
  beforeEach(() => createChatCompletion.mockReset());

  it("completa na 2ª rodada as palavras zeradas E as parciais, pedindo o que falta", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("I eat bread", "bread"),
        sentence("resposta lixo demais aqui fora", "milk")
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("milk is good", "milk")
      ] }) });
    const result = await generateSentencesForWords(
      [{ id: "w1", lemma: "bread" }, { id: "w2", lemma: "milk" }],
      ["eat", "good"], "Inglês", "B1"
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const secondUser = userContent(1);
    expect(secondUser).toContain("Palavras-alvo (com quantas frases faltam)");
    expect(secondUser).toContain('{"lemma":"bread","faltam":5}');
    expect(secondUser).toContain('{"lemma":"milk","faltam":6}');
    expect(result.sentencesByWord.get("w1")).toHaveLength(1);
    expect(result.sentencesByWord.get("w2")).toHaveLength(1);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("completa palavra parcial: pede só o faltante e limita o merge ao teto", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("the sun is bright", "sun"),
        sentence("the sun is warm", "sun"),
        sentence("the sun is high", "sun"),
        sentence("the moon is white", "moon"),
        sentence("the moon is round", "moon"),
        sentence("the moon is pale", "moon"),
        sentence("the moon is big", "moon"),
        sentence("the moon is near", "moon"),
        sentence("the moon is soft", "moon")
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("the sun is golden", "sun"),
        sentence("the sun is hot", "sun"),
        sentence("the sun is quiet", "sun"),
        sentence("the sun is huge", "sun"),
        sentence("the sun is old", "sun")
      ] }) });
    const result = await generateSentencesForWords(
      [{ id: "w1", lemma: "sun" }, { id: "w2", lemma: "moon" }],
      KNOWN, "Inglês", "B1"
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const secondUser = userContent(1);
    expect(secondUser).toContain("Palavras-alvo (com quantas frases faltam)");
    expect(secondUser).toContain('{"lemma":"sun","faltam":3}');
    expect(secondUser).not.toContain("moon");
    expect(systemContent(1)).toContain("Crie para cada palavra exatamente o número de frases indicado");
    expect(systemContent(0)).toContain(`crie exatamente 6 frases`);
    expect(userContent(0)).not.toContain("faltam");
    expect(result.sentencesByWord.get("w1")?.map((item) => item.text)).toEqual([
      "the sun is bright", "the sun is warm", "the sun is high",
      "the sun is golden", "the sun is hot", "the sun is quiet"
    ]);
    expect(result.sentencesByWord.get("w2")).toHaveLength(6);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("palavra zerada que não recebe nada válido na 2ª rodada segue em droppedWordIds", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("the sun is bright", "sun"),
        sentence("the sun is warm", "sun"),
        sentence("the sun is high", "sun"),
        sentence("the sun is white", "sun"),
        sentence("the sun is round", "sun"),
        sentence("the sun is pale", "sun"),
        sentence("resposta lixo demais aqui fora", "moon")
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("ainda sem frase válida aqui", "moon")
      ] }) });
    const result = await generateSentencesForWords(
      [{ id: "w1", lemma: "sun" }, { id: "w2", lemma: "moon" }],
      KNOWN, "Inglês", "B1"
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(userContent(1)).not.toContain("sun");
    expect(result.sentencesByWord.get("w1")).toHaveLength(6);
    expect(result.sentencesByWord.get("w2") ?? []).toHaveLength(0);
    expect(result.droppedWordIds).toEqual(["w2"]);
  });

  it("frase repetida da rodada 1 na rodada 2 não é somada", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("the sun is bright", "sun"),
        sentence("the sun is warm", "sun"),
        sentence("the sun is high", "sun")
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        sentence("the sun is bright", "sun"),
        sentence("the sun is golden", "sun"),
        sentence("the sun is hot", "sun"),
        sentence("the sun is quiet", "sun"),
        sentence("the sun is huge", "sun")
      ] }) });
    const result = await generateSentencesForWords([{ id: "w1", lemma: "sun" }], KNOWN, "Inglês", "B1");
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const texts = result.sentencesByWord.get("w1")?.map((item) => item.text) ?? [];
    expect(texts).toEqual([
      "the sun is bright", "the sun is warm", "the sun is high",
      "the sun is golden", "the sun is hot", "the sun is quiet"
    ]);
    expect(new Set(texts).size).toBe(texts.length);
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
