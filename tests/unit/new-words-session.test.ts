// tests/unit/new-words-session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion, client } = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
  client: {
    records: new Map<string, { id: string; fields: Record<string, unknown> }>(),
    seq: 0,
    reset() { this.records.clear(); this.seq = 0; },
    async createRecord(table: string, fields: Record<string, unknown>) {
      const id = `${table}-${++this.seq}`;
      this.records.set(id, { id, fields });
      return { id, fields };
    },
    async updateRecord(_table: string, id: string, fields: Record<string, unknown>) {
      const record = this.records.get(id);
      if (!record) throw new Error("not found");
      Object.assign(record.fields, fields);
      return record;
    },
    async listRecordsWhereAll() { return [...this.records.values()] as never; },
    async listRecords() { return [] as never; },
    async listRecordsWhere(_table: string, field: string, value: string) {
      return [...this.records.values()].filter((record) => record.fields[field] === value) as never;
    },
    async createEvent() {}
  }
}));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({ getTeableClient: () => client, TeableRequestError: class extends Error { status = 409; } }));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

import { validateGeneratedSentences } from "../../lib/learning/new-words-validation";

describe("geração de frases para palavras novas", () => {
  beforeEach(() => client.reset());

  it("usa somente frases validadas e respeita retries", async () => {
    const { generateSentencesForWords } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [{ text: "resposta lixo", translation: "x", word: "bread" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) });
    const result = await generateSentencesForWords([{ id: "w1", lemma: "bread" }], ["eat", "good", "want"], "Inglês", "B1");
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.sentencesByWord.get("w1")).toHaveLength(3);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("valida saída com validateGeneratedSentences (contrato compartilhado)", () => {
    const { sentencesByWord } = validateGeneratedSentences(
      [{ text: "bread is good", translation: "pão é bom", word: "bread" }],
      [{ id: "w1", lemma: "bread" }], ["good"]
    );
    expect(sentencesByWord.get("w1")?.[0].translation).toBe("pão é bom");
  });

  it("recompõe o pedido com a reposição quando a 1ª leva perde palavras", async () => {
    const { createNewWordsPractice } = await import("../../lib/learning/new-words");
    createChatCompletion
      // 1ª leva: propõe 3 palavras para o pedido de 3.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [
        { lemma: "bread", translation: "pão", part_of_speech: "noun" },
        { lemma: "rice", translation: "arroz", part_of_speech: "noun" },
        { lemma: "water", translation: "água", part_of_speech: "noun" }
      ] }) })
      // Frases da 1ª leva: só bread recebe frases válidas.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) })
      // 2ª rodada da 1ª leva: rice e water continuam sem frase válida.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [] }) })
      // Reposição: propõe exatamente as 2 palavras em falta.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        { lemma: "honey", translation: "mel", part_of_speech: "noun" }
      ] }) })
      // Frases da reposição: milk e honey completam o pedido.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "milk is good", translation: "leite é bom", word: "milk" },
        { text: "I want milk", translation: "eu quero leite", word: "milk" },
        { text: "milk and bread", translation: "leite e pão", word: "milk" },
        { text: "honey is sweet", translation: "mel é doce", word: "honey" },
        { text: "I want honey", translation: "eu quero mel", word: "honey" },
        { text: "honey and milk", translation: "mel e leite", word: "honey" }
      ] }) });
    const session = await createNewWordsPractice({ count: 3 });
    expect(session.words.map((word: { lemma: string }) => word.lemma)).toEqual(["bread", "milk", "honey"]);
    expect(session.sentences).toHaveLength(9);
    expect(session.requestedWordCount).toBe(3);
  });

  it("marca a sessão como failed quando a gravação dos cards falha", async () => {
    const { createNewWordsPractice } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) })
      // Reposição não acha palavra nova (só reproõe bread) e desiste sem erro.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) });
    const originalCreateRecord = client.createRecord.bind(client);
    client.createRecord = async (table: string, fields: Record<string, unknown>) => {
      if (table === "flashcards") throw new Error("falha ao gravar card");
      return originalCreateRecord(table, fields);
    };
    try {
      await expect(createNewWordsPractice({ count: 3 })).rejects.toThrow("falha ao gravar card");
      const session = [...client.records.values()].find((record) => record.id.startsWith("practiceSessions"));
      expect(session?.fields.type).toBe("new_words");
      expect(session?.fields.status).toBe("failed");
    } finally {
      client.createRecord = originalCreateRecord;
    }
  });
});
