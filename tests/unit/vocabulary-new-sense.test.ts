import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestMessage = {
  id: string;
  fields: {
    conversation_id: string;
    role: "user" | "assistant";
    text: string;
    audio_url: string;
    transcript_text: string;
    language_detected: string;
    tokens_used: number;
    created_at: string;
  };
};

function buildMessage(id: string, role: "user" | "assistant", text: string, conversationId = "conversation-1"): TestMessage {
  return {
    id,
    fields: {
      conversation_id: conversationId,
      role,
      text,
      audio_url: "",
      transcript_text: "",
      language_detected: "en",
      tokens_used: 0,
      created_at: "2026-08-12T10:00:00.000Z"
    }
  };
}

function buildCandidate(id: string, source: "user" | "assistant", occurrenceCount: number) {
  const normalized = id.split(":")[1];
  return {
    id,
    text: normalized,
    normalized,
    source,
    messageId: "message-1",
    context: "context",
    occurrenceCount,
    correctOccurrenceCount: occurrenceCount,
    incorrectOccurrenceCount: 0,
    eligible: true
  };
}

let messages: TestMessage[] = [];
let corrections: Array<{ id: string; fields: Record<string, unknown> }> = [];
let profile = { id: "profile-1", fields: { language_code: "en" } };
const words: Array<{ id: string; fields: Record<string, unknown> }> = [];
const senses: Array<{ id: string; fields: Record<string, unknown> }> = [];
const usageSummaries: Array<{ id: string; fields: Record<string, unknown> }> = [];
const users: Array<{ id: string; fields: Record<string, unknown> }> = [];
const listRecordsWhere = vi.fn();
const listRecordsWhereAll = vi.fn();
const getRecord = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const listRecords = vi.fn();
const createChatCompletion = vi.fn();
const addSavedWordsToDailyFeedback = vi.fn();

vi.mock("../../lib/ai/client", () => ({
  createChatCompletion
}));
vi.mock("../../lib/learning/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/learning/conversations")>();
  return {
    ...original,
    getConversation: vi.fn(async (conversationId: string) => ({
      conversation: {
        id: conversationId,
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          status: "completed",
          started_at: "2026-08-12T09:00:00.000Z",
          ended_at: "2026-08-12T10:00:00.000Z"
        }
      },
      profile,
      messages,
      corrections
    }))
  };
});
vi.mock("../../lib/learning/feedback", () => ({ addSavedWordsToDailyFeedback }));
vi.mock("../../lib/supabase/client", () => ({
  TeableRequestError: class TeableRequestError extends Error {
    status: number;
    constructor(status: number, message = "teable error") {
      super(message);
      this.status = status;
    }
  },
  getTeableClient: () => ({
    listRecords,
    listAllRecords: listRecords,
    listRecordsWhere,
    listRecordsWhereAll,
    getRecord,
    createRecord,
    updateRecord
  })
}));

const BANK_WORD = {
  user_id: "user-1",
  language_profile_id: "profile-1",
  lemma: "bank",
  display_text: "bank",
  canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
  forms_json: "[]",
  translation: "banco (instituição)",
  part_of_speech: "noun",
  total_uses: 3
};

function seedBankWord(overrides: Record<string, unknown> = {}) {
  words.push({ id: "word-bank", fields: { ...BANK_WORD, ...overrides } });
}

const KNOWN_FAMILY = {
  id: "word-bank",
  lemma: "bank",
  displayText: "bank",
  formsJson: "[]",
  senses: ["banco (instituição)"]
};

describe("AI analysis sense_status parsing", () => {
  beforeEach(() => {
    messages = [];
    corrections = [];
    profile = { id: "profile-1", fields: { language_code: "en" } };
    words.splice(0);
    senses.splice(0);
    usageSummaries.splice(0);
    vi.clearAllMocks();
    addSavedWordsToDailyFeedback.mockResolvedValue(undefined);
    createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
    listRecords.mockImplementation(async (table: string) =>
      table === "words"
        ? [...words]
        : table === "wordSenses"
          ? [...senses]
          : table === "wordUsageSummaries"
            ? [...usageSummaries]
            : []);
    const tableRecords = (table: string) =>
      table === "words" ? words : table === "wordSenses" ? senses : table === "wordUsageSummaries" ? usageSummaries : users;
    listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
      tableRecords(table).filter((record) => String(record.fields[field] ?? "") === value)
    );
    listRecordsWhereAll.mockImplementation(async (table: string, filters: Array<{ field: string; value: string }>) =>
      tableRecords(table).filter((record) => filters.every(({ field, value }) => String(record.fields[field] ?? "") === value))
    );
    getRecord.mockImplementation(async (table: string, id: string) => {
      const record = tableRecords(table).find((item) => item.id === id);
      if (!record) throw new Error("not found");
      return record;
    });
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      const target = table === "words" ? words : table === "wordSenses" ? senses : usageSummaries;
      const record = { id: `${table}-${target.length + 1}`, fields: { ...fields } };
      target.push(record);
      return record;
    });
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      const source = table === "words" ? words : table === "wordSenses" ? senses : usageSummaries;
      const record = source.find((item) => item.id === id)!;
      record.fields = { ...record.fields, ...fields };
      return record;
    });
  });

  it("sends the known words with their existing senses to the analysis", async () => {
    const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

    await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [KNOWN_FAMILY], "en");

    const userMessage = String(createChatCompletion.mock.calls[0][0][1].content);
    expect(userMessage).toContain("Palavras conhecidas");
    expect(userMessage).toContain("bank");
    expect(userMessage).toContain("banco (instituição)");
  });

  it("marks a known word used with a different meaning as a new sense", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: "new_sense" }
      ]),
      tokensUsed: 1
    });
    const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

    const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [KNOWN_FAMILY], "en");

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("new_sense_of_existing");
  });

  it("discards a known word when the analysis reports sense_status=known_sense", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "banco (instituição)", part_of_speech: "noun", sense_status: "known_sense" }
      ]),
      tokensUsed: 1
    });
    const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

    const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [KNOWN_FAMILY], "en");

    expect(groups).toHaveLength(0);
  });

  it("falls back to legacy behavior when sense_status is absent", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun" },
        { id: "user:telescope", lemma: "telescope", translation: "telescópio", part_of_speech: "noun" }
      ]),
      tokensUsed: 1
    });
    const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

    const groups = await groupNewVocabularyCandidates(
      [buildCandidate("user:bank", "user", 1), buildCandidate("user:telescope", "user", 1)],
      [KNOWN_FAMILY],
      "en"
    );

    // Legacy behavior: known lemmas are dropped, unknown lemmas are new words.
    expect(groups).toHaveLength(1);
    expect(groups[0].lemma).toBe("telescope");
    expect(groups[0].kind).toBe("new_word");
  });

  it.each([
    ["a numeric value", 42],
    ["an unexpected string", "NEW_SENSE"],
    ["an empty string", ""]
  ])("falls back to legacy behavior when sense_status is %s", async (_label, senseStatus) => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: senseStatus }
      ]),
      tokensUsed: 1
    });
    const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

    const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [KNOWN_FAMILY], "en");

    expect(groups).toHaveLength(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("saveSelectedVocabulary creates word senses", () => {
  beforeEach(() => {
    messages = [];
    corrections = [];
    profile = { id: "profile-1", fields: { language_code: "en" } };
    words.splice(0);
    senses.splice(0);
    usageSummaries.splice(0);
    vi.clearAllMocks();
    addSavedWordsToDailyFeedback.mockResolvedValue(undefined);
    createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
    listRecords.mockImplementation(async (table: string) =>
      table === "words"
        ? [...words]
        : table === "wordSenses"
          ? [...senses]
          : table === "wordUsageSummaries"
            ? [...usageSummaries]
            : []);
    const tableRecords = (table: string) =>
      table === "words" ? words : table === "wordSenses" ? senses : table === "wordUsageSummaries" ? usageSummaries : users;
    listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
      tableRecords(table).filter((record) => String(record.fields[field] ?? "") === value)
    );
    listRecordsWhereAll.mockImplementation(async (table: string, filters: Array<{ field: string; value: string }>) =>
      tableRecords(table).filter((record) => filters.every(({ field, value }) => String(record.fields[field] ?? "") === value))
    );
    getRecord.mockImplementation(async (table: string, id: string) => {
      const record = tableRecords(table).find((item) => item.id === id);
      if (!record) throw new Error("not found");
      return record;
    });
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      const target = table === "words" ? words : table === "wordSenses" ? senses : usageSummaries;
      const record = { id: `${table}-${target.length + 1}`, fields: { ...fields } };
      target.push(record);
      return record;
    });
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      const source = table === "words" ? words : table === "wordSenses" ? senses : usageSummaries;
      const record = source.find((item) => item.id === id)!;
      record.fields = { ...record.fields, ...fields };
      return record;
    });
  });

  it("creates the primary sense when saving a brand-new word", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
      tokensUsed: 1
    });
    messages = [buildMessage("m-solar", "user", "Solar panels")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
    const { canonicalSenseKey } = await import("../../lib/learning/word-senses");

    const result = await saveSelectedVocabulary("conversation-sense-new-word", ["user:solar"]);

    expect(result.newWordCount).toBe(1);
    expect(words).toHaveLength(1);
    expect(senses).toHaveLength(1);
    expect(senses[0].fields).toMatchObject({
      word_id: words[0].id,
      sense_key: canonicalSenseKey("user-1", "profile-1", "solar", "solar"),
      translation: "solar",
      part_of_speech: "adjective",
      example_sentence: "Solar panels",
      source: "chat",
      is_primary: true,
      sense_order: 1,
      review_state: "new"
    });
    expect(new Date(String(senses[0].fields.review_due_at)).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
  });

  it("does not duplicate senses when the same conversation is saved twice", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
      tokensUsed: 1
    });
    messages = [buildMessage("m-solar", "user", "Solar panels")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    await saveSelectedVocabulary("conversation-sense-resave", ["user:solar"]);
    const second = await saveSelectedVocabulary("conversation-sense-resave", ["user:solar"]);

    expect(second.savedCount).toBe(0);
    expect(words).toHaveLength(1);
    expect(senses).toHaveLength(1);
  });

  it("creates a non-primary sense for a new meaning of a known word without touching words.translation", async () => {
    seedBankWord();
    const { canonicalSenseKey } = await import("../../lib/learning/word-senses");
    senses.push({
      id: "sense-1",
      fields: {
        word_id: "word-bank",
        sense_key: canonicalSenseKey("user-1", "profile-1", "bank", "banco (instituição)"),
        translation: "banco (instituição)",
        is_primary: true,
        sense_order: 1,
        review_state: "review",
        review_due_at: "2099-01-01T00:00:00.000Z"
      }
    });
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: "new_sense" }
      ]),
      tokensUsed: 1
    });
    messages = [buildMessage("m-bank", "user", "I sat on the bank of the river")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    const result = await saveSelectedVocabulary("conversation-sense-new-meaning", ["user:bank"]);

    expect(result.newWordCount).toBe(0);
    expect(senses).toHaveLength(2);
    expect(senses[1].fields).toMatchObject({
      word_id: "word-bank",
      sense_key: canonicalSenseKey("user-1", "profile-1", "bank", "margem (do rio)"),
      translation: "margem (do rio)",
      part_of_speech: "noun",
      example_sentence: "I sat on the bank of the river",
      source: "chat",
      is_primary: false,
      sense_order: 2,
      review_state: "new"
    });
    // O cache da palavra mantém a tradução do sentido primário.
    expect(words[0].fields.translation).toBe("banco (instituição)");
    // Agregados SRS recalculados a partir dos sentidos.
    const aggregateUpdate = updateRecord.mock.calls.find(([table, id, fields]) =>
      table === "words" && id === "word-bank" && Object.prototype.hasOwnProperty.call(fields, "review_state"));
    expect(aggregateUpdate).toBeDefined();
  });

  it("treats an AI-flagged new sense as known when the normalized translation already exists", async () => {
    seedBankWord();
    const { canonicalSenseKey } = await import("../../lib/learning/word-senses");
    senses.push({
      id: "sense-1",
      fields: {
        word_id: "word-bank",
        sense_key: canonicalSenseKey("user-1", "profile-1", "bank", "banco (instituição)"),
        translation: "banco (instituição)",
        is_primary: true,
        sense_order: 1
      }
    });
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:bank", lemma: "bank", translation: "Banco (Instituição)", part_of_speech: "noun", sense_status: "new_sense" }
      ]),
      tokensUsed: 1
    });
    messages = [buildMessage("m-bank", "user", "I went to the bank")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    await saveSelectedVocabulary("conversation-sense-false-positive", ["user:bank"]);

    expect(senses).toHaveLength(1);
  });

  it("skips a flagged new sense whose translation stayed empty", async () => {
    seedBankWord();
    const { canonicalSenseKey } = await import("../../lib/learning/word-senses");
    senses.push({
      id: "sense-1",
      fields: {
        word_id: "word-bank",
        sense_key: canonicalSenseKey("user-1", "profile-1", "bank", "banco (instituição)"),
        translation: "banco (instituição)",
        is_primary: true,
        sense_order: 1
      }
    });
    createChatCompletion
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "", part_of_speech: "noun", sense_status: "new_sense" }
        ]),
        tokensUsed: 1
      })
      .mockResolvedValueOnce({ content: "[]", tokensUsed: 1 });
    messages = [buildMessage("m-bank", "user", "I sat on the bank of the river")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    await saveSelectedVocabulary("conversation-sense-empty-translation", ["user:bank"]);

    expect(senses).toHaveLength(1);
  });

  it("creates the primary sense for a legacy word whose translation is filled on save", async () => {
    seedBankWord({ translation: "" });
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco (instituição)", part_of_speech: "noun" }]),
      tokensUsed: 1
    });
    messages = [buildMessage("m-bank", "user", "I went to the bank")];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
    const { canonicalSenseKey } = await import("../../lib/learning/word-senses");

    const result = await saveSelectedVocabulary("conversation-sense-legacy-hole", ["user:bank"]);

    expect(result.updatedWordCount).toBe(1);
    expect(words[0].fields.translation).toBe("banco (instituição)");
    expect(senses).toHaveLength(1);
    expect(senses[0].fields).toMatchObject({
      word_id: "word-bank",
      sense_key: canonicalSenseKey("user-1", "profile-1", "bank", "banco (instituição)"),
      translation: "banco (instituição)",
      source: "chat",
      is_primary: true,
      sense_order: 1,
      review_state: "new"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
