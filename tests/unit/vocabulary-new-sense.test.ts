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
vi.mock("../../lib/teable/client", () => ({
  TeableRequestError: class TeableRequestError extends Error {
    status: number;
    constructor(status: number, message = "teable error") {
      super(message);
      this.status = status;
    }
  },
  getTeableClient: () => ({ listRecords, listAllRecords: listRecords, createRecord, updateRecord })
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
