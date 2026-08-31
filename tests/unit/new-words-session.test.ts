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
    const { generateNewWordSentences } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [{ text: "resposta lixo", translation: "x", word: "bread" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) });
    const result = await generateNewWordSentences([{ id: "w1", lemma: "bread" }], ["eat", "good", "want"], "Inglês", "B1");
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
});
