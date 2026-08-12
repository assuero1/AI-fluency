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
const senses: Array<{ id: string; fields: Record<string, unknown> }> = [];
const usageSummaries: Array<{ id: string; fields: Record<string, unknown> }> = [];
const users: Array<{ id: string; fields: Record<string, unknown> }> = [
  { id: "user-1", fields: { timezone: "UTC" } }
];
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

describe("vocabulary candidate selection", () => {
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
    listRecords.mockImplementation(async (table: string) => table === "words"
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
      // Ids outside each chunk are ignored by the analysis parser, so one
      // response covering every candidate keeps all chunks translated and the
      // translation fallback out of this call count.
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, lemma: candidate.normalized, translation: "x" }))),
        tokensUsed: 1
      });

      await groupNewVocabularyCandidates(candidates, [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      expect(createChatCompletion.mock.calls[0][1]).toMatchObject({ maxTokens: 2_000, timeoutMs: 15_000 });
    });

    it("logs an error and falls back when a chunk fails instead of swallowing it", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ content: "[]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");
      const candidates = Array.from({ length: 25 }, (_, index) => buildCandidate(`user:working${index}`, "user", 1));

      const groups = await groupNewVocabularyCandidates(candidates, [], "en");

      expect(error).toHaveBeenCalled();
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((group) => group.lemma.startsWith("working"))).toBe(true);
    });

    it("logs an error when the chunk response is not parseable JSON", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockResolvedValue({ content: "[{not json]", tokensUsed: 1 });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates([buildCandidate("user:working", "user", 1)], [], "en");

      expect(error).toHaveBeenCalled();
    });
  });

  describe("translation fallback", () => {
    it("retries missing translations in small batches before grouping", async () => {
      createChatCompletion
        .mockResolvedValueOnce({
          content: JSON.stringify([{ id: "user:biblioteca", lemma: "biblioteca", translation: "", part_of_speech: "noun" }]),
          tokensUsed: 1
        })
        .mockResolvedValueOnce({
          content: JSON.stringify([{ id: "user:biblioteca", translation: "biblioteca" }]),
          tokensUsed: 1
        });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:biblioteca", "user", 1)], [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(createChatCompletion.mock.calls[1][1]).toMatchObject({ maxTokens: 800, timeoutMs: 15_000 });
      expect(groups[0].translation).toBe("biblioteca");
    });

    it("keeps empty translations and logs an error when the fallback also fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockRejectedValue(new Error("provider down"));
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:working", "user", 1)], [], "en");

      expect(error).toHaveBeenCalled();
      expect(groups[0].translation).toBe("");
    });

    it("skips the fallback call when every candidate already has a translation", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:casa", lemma: "casa", translation: "house", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates([buildCandidate("user:casa", "user", 1)], [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });

    it("aborts the fallback after 2 consecutive failures when the provider is down", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const candidates = Array.from({ length: 11 }, (_, index) => buildCandidate(`user:working${index}`, "user", 1));
      // The analysis chunk answers without translations; with 11 candidates the
      // fallback would need 3 batches of 5, but bails out after 2 consecutive
      // failures: 1 (analysis chunk) + 2 (fallback attempts) calls total.
      createChatCompletion
        .mockResolvedValueOnce({
          content: JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, lemma: candidate.normalized, translation: "" }))),
          tokensUsed: 1
        })
        .mockRejectedValue(new Error("provider down"));
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      await groupNewVocabularyCandidates(candidates, [], "en");

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenCalled();
    });
  });

  describe("translation requirement", () => {
    it("does not create a new word when no translation could be generated", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      createChatCompletion.mockResolvedValue({ content: "[]", tokensUsed: 1 });
      messages = [buildMessage("m-solar", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-no-translation", ["user:solar"]);

      expect(result.newWordCount).toBe(0);
      expect(words).toHaveLength(0);
      expect(createRecord.mock.calls.filter(([table]) => table === "words")).toHaveLength(0);
      expect(error).toHaveBeenCalled();
    });

    it("fills the translation of an existing word that was saved without one", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "solar",
          display_text: "solar",
          canonical_key: JSON.stringify(["user-1", "profile-1", "solar"]),
          forms_json: "[]",
          translation: "",
          part_of_speech: "",
          total_uses: 1,
          last_used_at: "2026-07-01T10:00:00.000Z",
          first_used_at: "2026-07-01T10:00:00.000Z"
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-solar-2", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-fill-translation", ["user:solar"]);

      expect(result.newWordCount).toBe(0);
      expect(result.updatedWordCount).toBe(1);
      expect(words[0].fields.translation).toBe("solar");
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
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
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

  describe("new sense of an existing word", () => {
    const BANK_FAMILY = {
      id: "word-1",
      lemma: "bank",
      displayText: "bank",
      formsJson: "[]",
      senses: ["banco (instituição)"]
    };

    it("keeps a group flagged as a new sense with the existing word reference", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: "new_sense" }
        ]),
        tokensUsed: 1
      });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [BANK_FAMILY], "en");

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        kind: "new_sense_of_existing",
        existingWordId: "word-1",
        existingTranslation: "banco (instituição)"
      });
    });

    it("discards a new_sense flag when the normalized translation already exists as a sense", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "Banco (Instituição)", part_of_speech: "noun", sense_status: "new_sense" }
        ]),
        tokensUsed: 1
      });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [BANK_FAMILY], "en");

      expect(groups).toHaveLength(0);
    });

    it("keeps discarding known words that the analysis does not flag as a new sense", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "banco (instituição)", part_of_speech: "noun", sense_status: "known_sense" }
        ]),
        tokensUsed: 1
      });
      const { groupNewVocabularyCandidates } = await import("../../lib/learning/vocabulary-selection");

      const groups = await groupNewVocabularyCandidates([buildCandidate("user:bank", "user", 1)], [BANK_FAMILY], "en");

      expect(groups).toHaveLength(0);
    });

    it("surfaces a new sense through the conversation groups using the stored word_senses", async () => {
      profile = { id: "profile-1", fields: { language_code: "en" } };
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco (instituição)",
          total_uses: 3
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          translation: "banco (instituição)",
          is_primary: true,
          sense_order: 1
        }
      });
      messages = [buildMessage("m-bank", "user", "I sat on the bank of the river")];
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: "new_sense" }
        ]),
        tokensUsed: 1
      });
      const { getConversationVocabularyGroups } = await import("../../lib/learning/vocabulary-selection");

      const groups = await getConversationVocabularyGroups("conversation-new-sense-stored");
      const bank = groups.find((group) => group.lemma === "bank");

      expect(bank).toMatchObject({
        kind: "new_sense_of_existing",
        existingWordId: "word-1",
        existingTranslation: "banco (instituição)"
      });
    });

    it("falls back to the word translation as the known sense when the word has no word_senses rows", async () => {
      profile = { id: "profile-1", fields: { language_code: "en" } };
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco (instituição)",
          total_uses: 3
        }
      });
      messages = [buildMessage("m-bank", "user", "I sat on the bank of the river")];
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:bank", lemma: "bank", translation: "margem (do rio)", part_of_speech: "noun", sense_status: "new_sense" }
        ]),
        tokensUsed: 1
      });
      const { getConversationVocabularyGroups } = await import("../../lib/learning/vocabulary-selection");

      const groups = await getConversationVocabularyGroups("conversation-new-sense-legacy");
      const bank = groups.find((group) => group.lemma === "bank");

      expect(bank).toMatchObject({
        kind: "new_sense_of_existing",
        existingWordId: "word-1",
        existingTranslation: "banco (instituição)"
      });
    });
  });

  describe("assistant words exclusion", () => {
    it("rejects saving candidates that only the assistant used", async () => {
      messages = [buildMessage("m-ai", "assistant", "Serendipity ephemeral")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await expect(saveSelectedVocabulary("conversation-ai-only", ["assistant:serendipity"])).rejects.toThrow("Selecione ao menos uma palavra.");
      expect(words).toHaveLength(0);
    });

    it("does not offer assistant-only words in the picker groups", async () => {
      messages = [
        buildMessage("m-user", "user", "I enjoyed the concert"),
        buildMessage("m-ai", "assistant", "Serendipity ephemeral")
      ];
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([
          { id: "user:enjoyed", lemma: "enjoy", translation: "curtir", part_of_speech: "verb" },
          { id: "user:concert", lemma: "concert", translation: "show", part_of_speech: "noun" },
          { id: "assistant:serendipity", lemma: "serendipity", translation: "serendipidade", part_of_speech: "noun" }
        ]),
        tokensUsed: 1
      });
      const { getConversationVocabularyGroups } = await import("../../lib/learning/vocabulary-selection");

      const groups = await getConversationVocabularyGroups("conversation-ai-picker");

      expect(groups.every((group) => group.source === "user")).toBe(true);
      expect(groups.map((group) => group.lemma)).not.toContain("serendipity");
    });
  });

  describe("scoped reads", () => {
    it("saves using scoped queries instead of full-table scans", async () => {
      words.push({
        id: "word-other-user",
        fields: {
          user_id: "user-2",
          language_profile_id: "profile-2",
          lemma: "solar",
          display_text: "solar",
          canonical_key: JSON.stringify(["user-2", "profile-2", "solar"]),
          forms_json: "[]",
          translation: "solar",
          total_uses: 9
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-solar", "user", "Solar panels")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-scoped", ["user:solar"]);

      expect(result.newWordCount).toBe(1);
      expect(listRecordsWhereAll).toHaveBeenCalled();
      // Sem full-table scan de words nem de wordUsageSummaries no fluxo.
      expect(listRecords.mock.calls.filter(([table]) => table === "words" || table === "wordUsageSummaries")).toHaveLength(0);
      // A palavra de outro usuário não foi tocada.
      expect(words.find((word) => word.id === "word-other-user")?.fields.total_uses).toBe(9);
    });

    it("never full-scans wordSenses, even when creating a new sense", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 2
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "margem", part_of_speech: "noun", sense_status: "new_sense" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "The bank of the river")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-new-sense-no-scan", ["user:bank"]);

      expect(listRecords.mock.calls.filter(([table]) => table === "wordSenses")).toHaveLength(0);
      const created = senses.find((sense) => sense.fields.translation === "margem");
      expect(created?.fields.sense_order).toBe(2);
    });
  });

  describe("per-sense usage counting", () => {
    it("creates the primary sense of a new word already carrying the session usage count", async () => {
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:solar", lemma: "solar", translation: "solar", part_of_speech: "adjective" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-1", "user", "Solar panels"), buildMessage("m-2", "user", "Solar energy")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-sense-count-new", ["user:solar"]);

      expect(senses).toHaveLength(1);
      expect(senses[0].fields.total_uses).toBe(2);
    });

    it("increments the matching existing sense instead of creating a duplicate", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 3
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1,
          total_uses: 3
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "I went to the bank")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      await saveSelectedVocabulary("conversation-sense-count-existing", ["user:bank"]);

      expect(senses).toHaveLength(1);
      expect(senses[0].fields.total_uses).toBe(4);
    });

    it("does not double-count the sense when the same conversation is saved twice", async () => {
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 1
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1,
          total_uses: 1
        }
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "I went to the bank")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const first = await saveSelectedVocabulary("conversation-sense-count-retry", ["user:bank"]);
      const second = await saveSelectedVocabulary("conversation-sense-count-retry", ["user:bank"]);

      expect(first.savedCount).toBe(1);
      expect(second.savedCount).toBe(0);
      expect(senses).toHaveLength(1);
      expect(senses[0].fields.total_uses).toBe(2);
    });

    it("still saves the word when the sense usage increment fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      words.push({
        id: "word-1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "bank",
          display_text: "bank",
          canonical_key: JSON.stringify(["user-1", "profile-1", "bank"]),
          forms_json: "[]",
          translation: "banco",
          total_uses: 1
        }
      });
      senses.push({
        id: "sense-1",
        fields: {
          word_id: "word-1",
          sense_key: JSON.stringify(["user-1", "profile-1", "bank", "banco"]),
          translation: "banco",
          is_primary: true,
          sense_order: 1,
          total_uses: 1
        }
      });
      updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
        if (table === "wordSenses") throw new Error("teable down");
        const record = words.find((item) => item.id === id)!;
        record.fields = { ...record.fields, ...fields };
        return record;
      });
      createChatCompletion.mockResolvedValue({
        content: JSON.stringify([{ id: "user:bank", lemma: "bank", translation: "banco", part_of_speech: "noun" }]),
        tokensUsed: 1
      });
      messages = [buildMessage("m-bank", "user", "I went to the bank")];
      const { saveSelectedVocabulary } = await import("../../lib/learning/vocabulary-selection");

      const result = await saveSelectedVocabulary("conversation-sense-count-failure", ["user:bank"]);

      expect(result.updatedWordCount).toBe(1);
      expect(warn).toHaveBeenCalled();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
