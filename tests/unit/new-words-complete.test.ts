// tests/unit/new-words-complete.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion, client, events } = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
  events: [] as Array<{ userId: string; name: string; payload: Record<string, unknown> }>,
  client: {
    records: new Map<string, { id: string; fields: Record<string, unknown> }>(),
    seq: 0,
    reset() { this.records.clear(); this.seq = 0; events.length = 0; },
    seed(table: string, id: string, fields: Record<string, unknown>) {
      this.records.set(id, { id, fields });
    },
    byTable(table: string) {
      return [...this.records.values()].filter((record) => record.id.startsWith(`${table}-`));
    },
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
    async listRecordsWhereAll(table: string, filters: Array<{ field: string; value: string }>) {
      return this.byTable(table).filter((record) => filters.every((filter) => record.fields[filter.field] === filter.value)) as never;
    },
    async listRecords(table: string) { return this.byTable(table) as never; },
    async listRecordsWhere(table: string, field: string, value: string) {
      return this.byTable(table).filter((record) => record.fields[field] === value) as never;
    },
    async createEvent(userId: string, name: string, payload: Record<string, unknown>) {
      events.push({ userId, name, payload });
    }
  }
}));

vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({ getTeableClient: () => client, TeableRequestError: class extends Error { status = 409; } }));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

const NOW = new Date();
const startedAt = new Date(NOW.getTime() - 60_000).toISOString();

function seedCompletedSession() {
  client.seed("practiceSessions", "practiceSessions-1", {
    user_id: "user-1",
    language_profile_id: "profile-1",
    type: "new_words",
    focus: JSON.stringify({ count: 3, wordIds: ["words-1", "words-2"] }),
    status: "active",
    started_at: startedAt,
    created_at: startedAt
  });
  client.seed("flashcards", "flashcards-1", {
    user_id: "user-1",
    practice_session_id: "practiceSessions-1",
    card_type: "translation",
    initial_position: 0,
    sentence: "I eat bread",
    translation: "eu como pão"
  });
  client.seed("flashcards", "flashcards-2", {
    user_id: "user-1",
    practice_session_id: "practiceSessions-1",
    card_type: "translation",
    initial_position: 1,
    sentence: "bread is good",
    translation: "pão é bom"
  });
  client.seed("flashcardAttempts", "flashcardAttempts-1", {
    user_id: "user-1",
    practice_session_id: "practiceSessions-1",
    flashcard_id: "flashcards-1",
    was_correct: true,
    judgment_json: JSON.stringify({ verdict: "correct", feedback: "ok", correctedTranslation: "eu como pão" }),
    created_at: startedAt
  });
  client.seed("flashcardAttempts", "flashcardAttempts-2", {
    user_id: "user-1",
    practice_session_id: "practiceSessions-1",
    flashcard_id: "flashcards-2",
    was_correct: true,
    judgment_json: JSON.stringify({ verdict: "acceptable", feedback: "ok", correctedTranslation: "pão é bom", newSenseTranslation: "pão da vida" }),
    created_at: new Date(NOW.getTime() - 30_000).toISOString()
  });
  client.seed("words", "words-1", { user_id: "user-1", language_profile_id: "profile-1", lemma: "bread", display_text: "bread", translation: "pão" });
  client.seed("words", "words-2", { user_id: "user-1", language_profile_id: "profile-1", lemma: "butter", display_text: "butter", translation: "manteiga" });
  client.seed("wordSenses", "wordSenses-1", { user_id: "user-1", word_id: "words-1", translation: "pão", is_primary: true });
  client.seed("wordSenses", "wordSenses-2", { user_id: "user-1", word_id: "words-2", translation: "manteiga", is_primary: true });
}

describe("completeNewWordsPractice", () => {
  beforeEach(() => client.reset());

  it("conclui com score 100 e é idempotente", async () => {
    seedCompletedSession();
    const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
    const first = await completeNewWordsPractice("practiceSessions-1", "complete-0001");
    const second = await completeNewWordsPractice("practiceSessions-1", "complete-0001");
    expect(first.score).toBe(100);
    expect(first.sentenceCount).toBe(2);
    expect(first.wordCount).toBe(2);
    expect(first.newSensesAdded).toBe(1);
    expect(first.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(second).toEqual(first);
    // Idempotência persistida: resultado guardado no focus, evento único.
    expect(events.filter((event) => event.name === "new_words_session_completed")).toHaveLength(1);
    const session = client.records.get("practiceSessions-1");
    expect(session?.fields.status).toBe("completed");
  });

  it("recusa conclusão enquanto existirem frases pendentes", async () => {
    seedCompletedSession();
    client.records.delete("flashcardAttempts-2");
    const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
    await expect(completeNewWordsPractice("practiceSessions-1", "complete-0001")).rejects.toMatchObject({ status: 409 });
  });

  it("recusa completion id diferente após a sessão já contabilizada", async () => {
    seedCompletedSession();
    const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
    await completeNewWordsPractice("practiceSessions-1", "complete-0001");
    await expect(completeNewWordsPractice("practiceSessions-1", "complete-9999")).rejects.toMatchObject({ status: 409 });
  });

  it("devolve 404 para sessão inexistente", async () => {
    const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
    await expect(completeNewWordsPractice("practiceSessions-404", "complete-0001")).rejects.toMatchObject({ status: 404 });
  });

  it("conta as palavras novas no feedback do dia", async () => {
    seedCompletedSession();
    const today = new Date().toISOString().slice(0, 10);
    client.seed("dailyFeedbacks", `dailyFeedbacks-${today}`, {
      user_id: "user-1",
      language_profile_id: "profile-1",
      date: today,
      new_words_count: 1
    });
    const { completeNewWordsPractice } = await import("../../lib/learning/new-words");
    await completeNewWordsPractice("practiceSessions-1", "complete-0001");
    expect(client.records.get(`dailyFeedbacks-${today}`)?.fields.new_words_count).toBe(3);
  });
});
