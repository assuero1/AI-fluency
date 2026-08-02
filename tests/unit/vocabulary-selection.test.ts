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
      created_at: "2026-07-10T10:00:00.000Z"
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
          started_at: "2026-07-10T09:00:00.000Z",
          ended_at: "2026-07-10T10:00:00.000Z"
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
  TeableRequestError: class TeableRequestError extends Error {},
  getTeableClient: () => ({ listRecords, listAllRecords: listRecords, createRecord, updateRecord })
}));

describe("vocabulary candidate selection", () => {
  beforeEach(() => {
    messages = [];
    corrections = [];
    profile = { id: "profile-1", fields: { language_code: "en" } };
    words.splice(0);
    usageSummaries.splice(0);
    vi.clearAllMocks();
    addSavedWordsToDailyFeedback.mockResolvedValue(undefined);
    createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
    listRecords.mockImplementation(async (table: string) => table === "words"
      ? [...words]
      : table === "wordUsageSummaries"
        ? [...usageSummaries]
        : []);
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      const target = table === "words" ? words : usageSummaries;
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

  describe("stopword filtering", () => {
    it("flags target-language and Portuguese stopwords but keeps content words", async () => {
      const { isVocabularyStopword } = await import("../../lib/learning/vocabulary-selection");

      expect(isVocabularyStopword("que", "es")).toBe(true);
      expect(isVocabularyStopword("es", "es")).toBe(true);
      expect(isVocabularyStopword("una", "es")).toBe(true);
      expect(isVocabularyStopword("pero", "es")).toBe(true);
      expect(isVocabularyStopword("hoy", "es")).toBe(true);
      expect(isVocabularyStopword("biblioteca", "es")).toBe(false);
      expect(isVocabularyStopword("the", "en")).toBe(true);
      expect(isVocabularyStopword("house", "en")).toBe(false);
      // Portuguese (native language) is filtered in every target language.
      expect(isVocabularyStopword("mas", "en")).toBe(true);
      expect(isVocabularyStopword("até", "es")).toBe(true);
    });

    it("drops Spanish function words and Portuguese contamination from candidates", async () => {
      const { extractVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      messages = [buildMessage("m-es", "user", "que es una pero hoy biblioteca roja")];

      const spanish = extractVocabularyCandidates(messages, [], "es").map((candidate) => candidate.normalized);

      expect(spanish).toEqual(["biblioteca", "roja"]);

      messages = [buildMessage("m-en", "user", "I went ao mercado yesterday")];
      const english = extractVocabularyCandidates(messages, [], "en").map((candidate) => candidate.normalized);

      expect(english).toContain("went");
      expect(english).toContain("mercado");
      expect(english).not.toContain("ao");
    });

    it("keeps every token when the language is unknown", async () => {
      const { extractVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      messages = [buildMessage("m-auto", "user", "the house ao lado")];

      const ids = extractVocabularyCandidates(messages).map((candidate) => candidate.normalized);

      expect(ids).toContain("the");
      expect(ids).toContain("house");
      expect(ids).not.toContain("ao");
    });
  });

  describe("diacritic-insensitive normalization", () => {
    it("normalizes case and strips diacritics", async () => {
      const { normalizeVocabularyToken } = await import("../../lib/learning/vocabulary-selection");

      expect(normalizeVocabularyToken(" Café ")).toBe("cafe");
      expect(normalizeVocabularyToken("SÃO")).toBe("sao");
      expect(normalizeVocabularyToken("niño")).toBe("nino");
    });

    it("matches irregular lemmas regardless of diacritics", async () => {
      const { fallbackVocabularyLemma } = await import("../../lib/learning/vocabulary-selection");

      expect(fallbackVocabularyLemma("são", "pt")).toBe("ser");
      expect(fallbackVocabularyLemma("sao", "pt-BR")).toBe("ser");
      expect(fallbackVocabularyLemma("était", "fr")).toBe("etre");
    });

    it("matches existing words whose canonical_key keeps the legacy accented form", async () => {
      profile = { id: "profile-1", fields: { language_code: "en" } };
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "café",
          display_text: "café",
          canonical_key: JSON.stringify(["user-1", "profile-1", "café"]),
          forms_json: "[]",
          total_uses: 1
        }
      });
      messages = [buildMessage("m-cafe", "user", "Cafe culture")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-legacy-key", ["user:cafe"]);

      expect(result.newWordCount).toBe(0);
      expect(result.updatedWordCount).toBe(1);
      expect(words).toHaveLength(1);
      expect(createRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
    });
  });

  describe("batched linguistic analysis", () => {
    it("splits large candidate sets into chunks of at most 20", async () => {
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = Array.from({ length: 45 }, (_, index) => buildCandidate(`user:w${index}`, "user", 1));

      await groupNewVocabularyCandidates(candidates, [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      expect(createChatCompletion.mock.calls[0][1]).toMatchObject({ maxTokens: 600 });
    });

    it("warns and falls back when a chunk fails instead of swallowing the error", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      createChatCompletion
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ content: "[]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = Array.from({ length: 25 }, (_, index) => buildCandidate(`user:working${index}`, "user", 1));

      const groups = await groupNewVocabularyCandidates(candidates, [], "en");

      expect(warn).toHaveBeenCalled();
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((group) => group.lemma.startsWith("working"))).toBe(true);
    });

    it("warns when the chunk response is not parseable JSON", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      createChatCompletion.mockResolvedValue({ content: "[{not json]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates([buildCandidate("user:working", "user", 1)], [], "en");

      expect(warn).toHaveBeenCalled();
    });
  });

  describe("shared analysis cache", () => {
    it("reuses the picker analysis when saving so lemmas cannot diverge", async () => {
      profile = { id: "profile-1", fields: { language_code: "en" } };
      messages = [
        buildMessage("m-user", "user", "I worked yesterday"),
        buildMessage("m-assistant", "assistant", "Working is fun")
      ];
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:worked", lemma: "Work", translation: "trabalhar", part_of_speech: "verb" },
          { id: "user:yesterday", lemma: "yesterday", translation: "ontem", part_of_speech: "adverb" },
          { id: "assistant:working", lemma: "work", translation: "trabalhar", part_of_speech: "verb" },
          { id: "assistant:fun", lemma: "fun", translation: "diversão", part_of_speech: "noun" }
        ]),
        tokensUsed: 1
      });
      const { getConversationVocabularyGroups, saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const groups = await getConversationVocabularyGroups("conversation-cache");
      expect(groups.map((group) => group.lemma)).toContain("work");
      expect(createChatCompletion).toHaveBeenCalledTimes(1);

      const result = await saveSelectedVocabulary("conversation-cache", ["user:worked"]);

      expect(createChatCompletion).toHaveBeenCalledTimes(1);
      expect(result.newWordCount).toBe(1);
      expect(words[0].fields.lemma).toBe("work");
      expect(words[0].fields.translation).toBe("trabalhar");
    });
  });

  describe("candidate ranking", () => {
    it("ranks learner words by frequency before assistant words when capping", async () => {
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = [
        ...Array.from({ length: 5 }, (_, index) => buildCandidate(`assistant:a${index}`, "assistant", 9)),
        ...Array.from({ length: 80 }, (_, index) => buildCandidate(`user:u${index}`, "user", 1))
      ];

      const groups = await groupNewVocabularyCandidates(candidates, [], "en");
      const lemmas = groups.map((group) => group.lemma);

      expect(groups).toHaveLength(80);
      expect(lemmas).toContain("u79");
      expect(lemmas).not.toContain("a0");
    });

    it("ranks more frequent learner words first within the same source", async () => {
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = [
        ...Array.from({ length: 79 }, (_, index) => buildCandidate(`user:rare${index}`, "user", 1)),
        buildCandidate("user:frequent", "user", 7),
        buildCandidate("assistant:overflow", "assistant", 99)
      ];

      const groups = await groupNewVocabularyCandidates(candidates, [], "en");
      const lemmas = groups.map((group) => group.lemma);

      expect(lemmas).toContain("frequent");
      expect(lemmas).not.toContain("overflow");
    });
  });

  describe("save-time family matching", () => {
    it("updates an existing word when the selected form is one of its saved forms", async () => {
      profile = { id: "profile-1", fields: { language_code: "en" } };
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "eat",
          display_text: "eat",
          canonical_key: JSON.stringify(["user-1", "profile-1", "eat"]),
          forms_json: JSON.stringify(["eat", "ate", "eaten"]),
          translation: "comer",
          total_uses: 2,
          last_used_at: "2026-07-01T10:00:00.000Z",
          first_used_at: "2026-07-01T10:00:00.000Z"
        }
      });
      messages = [buildMessage("m-eat", "user", "I have eaten lunch")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-forms", ["user:eaten"]);

      expect(result.newWordCount).toBe(0);
      expect(result.updatedWordCount).toBe(1);
      expect(words).toHaveLength(1);
      expect(words[0].fields.lemma).toBe("eat");
      expect(JSON.parse(String(words[0].fields.forms_json))).toContain("eaten");
    });
  });

  describe("feedback count resilience", () => {
    it("still resolves the save when the daily feedback bump fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      addSavedWordsToDailyFeedback.mockRejectedValue(new Error("teable down"));
      messages = [buildMessage("m-solar", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-feedback-failure", ["user:solar"]);

      expect(result.newWordCount).toBe(1);
      expect(words).toHaveLength(1);
      expect(addSavedWordsToDailyFeedback).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe("SRS decoupling", () => {
    function pushReviewWord(id: string, fields: Record<string, unknown>) {
      words.push({
        id,
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "cafe",
          display_text: "cafe",
          canonical_key: JSON.stringify(["user-1", "profile-1", "cafe"]),
          forms_json: "[]",
          translation: "café",
          part_of_speech: "noun",
          total_uses: 5,
          familiarity_score: 6,
          ...fields
        }
      });
      messages = [buildMessage(`m-${id}`, "user", "cafe culture")];
    }

    it("no longer rewrites review_due_at when an existing word is saved again", async () => {
      pushReviewWord("word-future", { review_state: "review", review_due_at: "2099-01-01T09:00:00.000Z", review_interval_days: 30, review_streak: 5, review_ease: 2.5 });
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
      await saveSelectedVocabulary("conversation-srs-1", ["user:cafe"]);

      const wordUpdates = updateRecord.mock.calls.filter(([table, id]) => table === "words" && id === "word-future");
      expect(wordUpdates).toHaveLength(1);
      expect(wordUpdates[0][2]).not.toHaveProperty("review_due_at");
      expect(words[0].fields.review_due_at).toBe("2099-01-01T09:00:00.000Z");
    });

    it("credits an implicit review when a due graduated word is used correctly", async () => {
      pushReviewWord("word-due", { review_state: "review", review_due_at: "2020-01-01T09:00:00.000Z", review_interval_days: 30, review_streak: 5, review_ease: 2.5 });
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");
      await saveSelectedVocabulary("conversation-srs-2", ["user:cafe"]);

      const payload = updateRecord.mock.calls.find(([table, id]) => table === "words" && id === "word-due")?.[2] as Record<string, unknown>;
      expect(payload).toMatchObject({ review_version: "srs-v2", review_state: "review", review_streak: 6 });
      expect(payload.implicit_review_at).toBeTruthy();
      expect(payload.review_interval_days as number).toBeGreaterThanOrEqual(67);
      expect(payload.review_interval_days as number).toBeLessThanOrEqual(83);
      expect(new Date(payload.review_due_at as string).getTime()).toBeGreaterThan(Date.now());
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
