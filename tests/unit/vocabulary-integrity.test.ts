import { beforeEach, describe, expect, it, vi } from "vitest";

const messages = [
  {
    id: "message-user-1",
    fields: {
      conversation_id: "conversation-1",
      role: "user" as const,
      text: "Work work WORK café",
      audio_url: "",
      transcript_text: "",
      language_detected: "en",
      tokens_used: 0,
      created_at: "2026-07-10T10:00:00.000Z"
    }
  },
  {
    id: "message-assistant-1",
    fields: {
      conversation_id: "conversation-1",
      role: "assistant" as const,
      text: "Work is useful.",
      audio_url: "",
      transcript_text: "",
      language_detected: "en",
      tokens_used: 0,
      created_at: "2026-07-10T10:01:00.000Z"
    }
  },
  {
    id: "message-user-2",
    fields: {
      conversation_id: "conversation-1",
      role: "user" as const,
      text: "Worked working",
      audio_url: "",
      transcript_text: "",
      language_detected: "en",
      tokens_used: 0,
      created_at: "2026-07-10T10:02:00.000Z"
    }
  }
];

const words: Array<{ id: string; fields: Record<string, unknown> }> = [];
const occurrences: Array<{ id: string; fields: Record<string, unknown> }> = [];
const usageSummaries: Array<{ id: string; fields: Record<string, unknown> }> = [];
const createRecord = vi.fn();
const updateRecord = vi.fn();
const listRecords = vi.fn();
const createChatCompletion = vi.fn();
let corrections: Array<{ id: string; fields: Record<string, unknown> }> = [];

vi.mock("../../lib/ai/client", () => ({
  createChatCompletion
}));
vi.mock("../../lib/learning/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/learning/conversations")>();
  return {
    ...original,
    getConversation: vi.fn(async () => ({
      conversation: { id: "conversation-1", fields: { user_id: "user-1", language_profile_id: "profile-1", status: "completed" } },
      profile: { id: "profile-1", fields: { language_code: "en" } },
      messages,
      corrections
    }))
  };
});
vi.mock("../../lib/learning/feedback", () => ({ addSavedWordsToDailyFeedback: vi.fn(async () => undefined) }));
vi.mock("../../lib/teable/client", () => ({
  TeableRequestError: class TeableRequestError extends Error {},
  getTeableClient: () => ({ listRecords, listAllRecords: listRecords, createRecord, updateRecord })
}));

describe("vocabulary integrity", () => {
  beforeEach(() => {
    words.splice(0);
    occurrences.splice(0);
    usageSummaries.splice(0);
    corrections = [];
    vi.clearAllMocks();
    createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
    listRecords.mockImplementation(async (table: string) => table === "words"
      ? [...words]
      : table === "messages"
        ? [...messages]
        : table === "wordUsageSummaries"
          ? [...usageSummaries]
          : [...occurrences]);
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      const target = table === "words" ? words : table === "wordUsageSummaries" ? usageSummaries : occurrences;
      const record = { id: `${table}-${target.length + 1}`, fields: { ...fields } };
      target.push(record);
      return record;
    });
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      const record = (table === "wordUsageSummaries" ? usageSummaries : words).find((item) => item.id === id)!;
      record.fields = { ...record.fields, ...fields };
      return record;
    });
  });

  it("groups equal normalized tokens but preserves their real frequency", async () => {
    const { extractVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
    const candidates = extractVocabularyCandidates(messages);

    expect(candidates.find((item) => item.id === "user:work")?.occurrenceCount).toBe(3);
    expect(candidates.find((item) => item.id === "assistant:work")?.occurrenceCount).toBe(1);
    expect(candidates.find((item) => item.id === "user:café")?.occurrenceCount).toBe(1);
  });

  it("has deterministic lemma fallbacks for supported languages", async () => {
    const { fallbackVocabularyLemma } = await import("../../lib/learning/vocabulary-selection");
    expect(fallbackVocabularyLemma("working", "en-US")).toBe("work");
    expect(fallbackVocabularyLemma("hablando", "es")).toBe("hablar");
    expect(fallbackVocabularyLemma("parlant", "fr")).toBe("parler");
    expect(fallbackVocabularyLemma("parlando", "it")).toBe("parlare");
    expect(fallbackVocabularyLemma("fomos", "pt-BR")).toBe("ir");
  });

  it("groups related forms under one selectable lemma", async () => {
    const { extractVocabularyCandidates, groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
    const candidates = extractVocabularyCandidates(messages).filter((candidate) => ["user:worked", "user:working"].includes(candidate.id));

    const groups = await groupNewVocabularyCandidates(candidates, [], "en-US");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ lemma: "work", candidateIds: ["user:worked", "user:working"] });
    expect(groups[0].forms.map((form) => form.toLowerCase())).toEqual(["worked", "working"]);
  });

  it("does not offer a related form when its family already exists", async () => {
    const { extractVocabularyCandidates, groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
    const candidates = extractVocabularyCandidates(messages).filter((candidate) => ["user:worked", "user:working"].includes(candidate.id));

    const groups = await groupNewVocabularyCandidates(candidates, [{ lemma: "work", displayText: "work", formsJson: "[]" }], "en-US");

    expect(groups).toEqual([]);
  });

  it("keeps only candidates that are not already in the vocabulary", async () => {
    const { extractVocabularyCandidates, filterNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
    const candidates = extractVocabularyCandidates(messages);

    const filtered = filterNewVocabularyCandidates(candidates, ["work"], "en-US");

    expect(filtered.map((candidate) => candidate.id)).not.toContain("user:work");
    expect(filtered.map((candidate) => candidate.id)).not.toContain("assistant:work");
    expect(filtered.map((candidate) => candidate.id)).not.toContain("user:worked");
    expect(filtered.map((candidate) => candidate.id)).not.toContain("user:working");
    expect(filtered.map((candidate) => candidate.id)).toContain("user:café");
  });

  it("increments by each missing occurrence and is idempotent on retries", async () => {
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    const first = await saveSelectedVocabulary("conversation-1", ["user:work"]);
    const retry = await saveSelectedVocabulary("conversation-1", ["user:work"]);

    expect(first.savedCount).toBe(3);
    expect(retry.savedCount).toBe(0);
    expect(words).toHaveLength(1);
    expect(words[0].fields.total_uses).toBe(3);
    expect(occurrences).toHaveLength(0);
    expect(usageSummaries).toHaveLength(1);
    expect(usageSummaries[0].fields.correct_use_count).toBe(3);
  });

  it("backfills only occurrences missing from an earlier partial save", async () => {
    words.push({ id: "word-1", fields: { user_id: "user-1", language_profile_id: "profile-1", lemma: "WORK", display_text: "Work", total_uses: 1 } });
    usageSummaries.push({ id: "usage-1", fields: { usage_key: JSON.stringify(["word-1", "conversation-1"]), word_id: "word-1", conversation_id: "conversation-1", observed_count: 1, correct_use_count: 1, correction_count: 0 } });
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    const result = await saveSelectedVocabulary("conversation-1", ["user:work"]);

    expect(result.savedCount).toBe(2);
    expect(words).toHaveLength(1);
    expect(words[0].fields.total_uses).toBe(3);
    expect(usageSummaries).toHaveLength(1);
    expect(usageSummaries[0].fields.observed_count).toBe(3);
  });

  it("records assistant vocabulary without counting it as learner usage", async () => {
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    const result = await saveSelectedVocabulary("conversation-1", ["user:work", "assistant:work"]);

    expect(result.savedCount).toBe(4);
    expect(result.newWordCount).toBe(1);
    expect(words).toHaveLength(1);
    expect(words[0].fields.total_uses).toBe(3);
    expect(occurrences).toHaveLength(0);
    expect(usageSummaries[0].fields.observed_count).toBe(4);
  });

  it("marks only changed correction tokens as ineligible", async () => {
    const { extractVocabularyCandidates, findChangedOriginalTokens } = await import("../../lib/learning/vocabulary-selection");
    expect(findChangedOriginalTokens("I go to work", "I went to work")).toEqual(["go"]);
    const correctedMessages = [{ ...messages[0], fields: { ...messages[0].fields, text: "I go to work" } }];
    const correction = [{ id: "correction-1", fields: { message_id: "message-user-1", original_text: "I go to work", corrected_text: "I went to work" } }];
    const candidates = extractVocabularyCandidates(correctedMessages, correction as never);

    expect(candidates.find((item) => item.id === "user:go")?.eligible).toBe(false);
    expect(candidates.find((item) => item.id === "user:work")?.eligible).toBe(true);
  });

  it("consolidates inflected forms under the lemma returned by linguistic analysis", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify([
        { id: "user:worked", lemma: "work", translation: "trabalhar" },
        { id: "user:working", lemma: "work", translation: "trabalhar" }
      ]),
      tokensUsed: 1
    });
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    await saveSelectedVocabulary("conversation-1", ["user:worked", "user:working"]);

    expect(words).toHaveLength(1);
    expect(words[0].fields.lemma).toBe("work");
    expect(JSON.parse(String(words[0].fields.forms_json))).toEqual(["Worked", "working"]);
    expect(words[0].fields.total_uses).toBe(2);
  });

  it("rejects corrected occurrences on the server even when their id is submitted", async () => {
    corrections = [{ id: "correction-1", fields: { conversation_id: "conversation-1", message_id: "message-user-1", original_text: "Work", corrected_text: "Worked" } }];
    const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

    const result = await saveSelectedVocabulary("conversation-1", ["user:work"]);

    expect(result.rejectedCount).toBe(1);
    expect(result.savedCount).toBe(2);
    expect(words[0].fields.total_uses).toBe(2);
  });
});
