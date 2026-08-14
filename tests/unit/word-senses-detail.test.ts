import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WordFields, WordSenseFields, WordUsageSummaryFields } from "../../lib/learning/conversations";
import { LearningStateError } from "../../lib/learning/access";
import { canonicalSenseKey } from "../../lib/learning/word-senses";
import type { TeableRecord } from "../../lib/teable/client";

const user = { id: "user-a", fields: { timezone: "UTC" } };
const profile = { id: "profile-a", fields: { language_code: "es", language_name: "Espanhol", weekly_word_goal: 500 } };

const listRecords = vi.fn();
const listAllRecords = vi.fn();
const listRecordsWhere = vi.fn();
const listRecordsWhereAll = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const createEvent = vi.fn();

vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile),
  getDailyNewCardsQuota: vi.fn(() => 10)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, listAllRecords, listRecordsWhere, listRecordsWhereAll, createRecord, updateRecord, createEvent }),
  TeableRequestError: class TeableRequestError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
}));

const bancoWord: TeableRecord<WordFields> = {
  id: "word-banco",
  fields: {
    user_id: user.id,
    language_profile_id: profile.id,
    lemma: "banco",
    display_text: "banco",
    translation: "banco (assento)",
    part_of_speech: "noun",
    total_uses: 4,
    familiarity_score: 2,
    first_used_at: "2026-07-01T00:00:00.000Z",
    last_used_at: "2026-08-01T00:00:00.000Z",
    review_due_at: "2026-08-01T09:00:00.000Z",
    review_streak: 3,
    lapse_count: 1,
    review_state: "review"
  }
};

const bancoUsage: TeableRecord<WordUsageSummaryFields> = {
  id: "usage-banco",
  fields: {
    user_id: user.id,
    usage_key: "usage-banco",
    word_id: "word-banco",
    conversation_id: "conv-1",
    forms_json: "[]",
    observed_count: 4,
    correct_use_count: 2,
    correction_count: 0,
    first_used_at: "2026-07-01T00:00:00.000Z",
    last_used_at: "2026-08-01T00:00:00.000Z"
  }
};

// Listed out of order on purpose: the detail mapping must sort by sense_order.
const bancoSenses: TeableRecord<WordSenseFields>[] = [
  {
    id: "sense-bank",
    fields: {
      user_id: user.id,
      word_id: "word-banco",
      translation: "banco (instituição)",
      part_of_speech: "noun",
      is_primary: false,
      sense_order: 2,
      source: "chat",
      review_state: "learning",
      review_due_at: "2026-08-01T09:00:00.000Z",
      review_streak: 1,
      lapse_count: 2
    }
  },
  {
    id: "sense-seat",
    fields: {
      user_id: user.id,
      word_id: "word-banco",
      translation: "banco (assento)",
      part_of_speech: "noun",
      example_sentence: "Me senté en el banco.",
      is_primary: true,
      sense_order: 1,
      source: "backfill",
      review_state: "review",
      review_due_at: "2026-08-20T09:00:00.000Z",
      review_streak: 5,
      lapse_count: 0
    }
  }
];

function mockWordEnvironment(words: TeableRecord<WordFields>[], senses: TeableRecord<WordSenseFields>[]) {
  const tableData = (table: string) => {
    if (table === "words") return words as TeableRecord<Record<string, unknown>>[];
    if (table === "wordUsageSummaries") return [bancoUsage] as TeableRecord<Record<string, unknown>>[];
    if (table === "wordSenses") return senses as TeableRecord<Record<string, unknown>>[];
    return [] as TeableRecord<Record<string, unknown>>[];
  };
  listAllRecords.mockImplementation(async (table: string) => tableData(table));
  listRecordsWhere.mockImplementation(async (table: string, field: string, value: string) =>
    tableData(table).filter((record) => String(record.fields[field] ?? "") === value)
  );
  listRecordsWhereAll.mockImplementation(async (table: string, filters: Array<{ field: string; value: string }>) =>
    tableData(table).filter((record) => filters.every((filter) => String(record.fields[filter.field] ?? "") === filter.value))
  );
}

describe("getWordDetail with senses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecords.mockResolvedValue([]);
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("returns every sense ordered by sense_order with its own SRS state", async () => {
    mockWordEnvironment([bancoWord], bancoSenses);
    const { getWordDetail } = await import("../../lib/learning/words");

    const data = await getWordDetail("word-banco");

    expect(data?.word.id).toBe("word-banco");
    expect(data?.senses.map((sense) => sense.id)).toEqual(["sense-seat", "sense-bank"]);
    expect(data?.senses[0]).toEqual({
      id: "sense-seat",
      translation: "banco (assento)",
      partOfSpeech: "noun",
      exampleSentence: "Me senté en el banco.",
      isPrimary: true,
      source: "backfill",
      reviewState: "review",
      reviewDueAt: "2026-08-20T09:00:00.000Z",
      reviewStreak: 5,
      lapseCount: 0,
      needsReview: false,
      totalUses: 0
    });
    expect(data?.senses[1]).toMatchObject({
      id: "sense-bank",
      translation: "banco (instituição)",
      isPrimary: false,
      source: "chat",
      reviewState: "learning",
      reviewStreak: 1,
      lapseCount: 2,
      needsReview: true
    });
  });

  it("falls back to a synthetic primary sense mirroring the word for legacy words", async () => {
    mockWordEnvironment([bancoWord], []);
    const { getWordDetail } = await import("../../lib/learning/words");

    const data = await getWordDetail("word-banco");

    expect(data?.senses).toHaveLength(1);
    expect(data?.senses[0]).toEqual({
      id: "",
      translation: "banco (assento)",
      partOfSpeech: "noun",
      exampleSentence: "",
      isPrimary: true,
      source: "chat",
      reviewState: "review",
      reviewDueAt: "2026-08-01T09:00:00.000Z",
      reviewStreak: 3,
      lapseCount: 1,
      needsReview: true,
      totalUses: 4
    });
  });

  it("marks a suspended sense as not needing review even when overdue", async () => {
    mockWordEnvironment([bancoWord], [{
      id: "sense-suspended",
      fields: {
        user_id: user.id,
        word_id: "word-banco",
        translation: "banco (assento)",
        is_primary: true,
        sense_order: 1,
        review_state: "suspended",
        review_due_at: "2026-08-01T09:00:00.000Z"
      }
    }]);
    const { getWordDetail } = await import("../../lib/learning/words");

    const data = await getWordDetail("word-banco");

    expect(data?.senses[0]).toMatchObject({ reviewState: "suspended", needsReview: false });
  });

  it("returns null for unknown words or words outside the learner's scope", async () => {
    mockWordEnvironment([bancoWord, { id: "word-foreign", fields: { ...bancoWord.fields, user_id: "user-b" } }], bancoSenses);
    const { getWordDetail } = await import("../../lib/learning/words");

    await expect(getWordDetail("word-missing")).resolves.toBeNull();
    await expect(getWordDetail("word-foreign")).resolves.toBeNull();
  });
});

describe("addManualWordSense", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecords.mockResolvedValue([]);
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("creates a manual sense with the next sense_order, scheduled immediately, and re-aggregates the word cache", async () => {
    const senses = [...bancoSenses];
    mockWordEnvironment([bancoWord], senses);
    createRecord.mockImplementation(async (_table: string, fields: Record<string, unknown>) => {
      const record = { id: "sense-new", fields: fields as WordSenseFields };
      senses.push(record);
      return record;
    });
    updateRecord.mockResolvedValue({});
    const { addManualWordSense } = await import("../../lib/learning/words");

    const created = await addManualWordSense("word-banco", { translation: "banco (parque)", partOfSpeech: "noun", exampleSentence: "Nos vimos en el banco del parque." });

    expect(createRecord).toHaveBeenCalledTimes(1);
    const [table, fields] = createRecord.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("wordSenses");
    expect(fields).toMatchObject({
      user_id: user.id,
      word_id: "word-banco",
      sense_key: canonicalSenseKey(user.id, profile.id, "banco", "banco (parque)"),
      translation: "banco (parque)",
      part_of_speech: "noun",
      example_sentence: "Nos vimos en el banco del parque.",
      source: "manual",
      is_primary: false,
      sense_order: 3,
      review_state: "new"
    });
    expect(typeof fields.review_due_at).toBe("string");
    expect(Date.parse(fields.review_due_at as string)).toBeLessThanOrEqual(Date.now());

    expect(created).toMatchObject({ id: "sense-new", translation: "banco (parque)", isPrimary: false, source: "manual", reviewState: "new" });

    // The word cache is re-aggregated from the fresh senses so the new sense
    // becomes schedulable: earliest due date, worst state, primary translation.
    const wordUpdates = updateRecord.mock.calls.filter(([target]) => target === "words");
    expect(wordUpdates).toHaveLength(1);
    expect(wordUpdates[0][1]).toBe("word-banco");
    expect(wordUpdates[0][2]).toMatchObject({
      review_due_at: "2026-08-01T09:00:00.000Z",
      review_state: "learning",
      translation: "banco (assento)"
    });
  });

  it("rejects a duplicate translation with a 409 conflict before creating anything", async () => {
    mockWordEnvironment([bancoWord], bancoSenses);
    const { addManualWordSense } = await import("../../lib/learning/words");

    const error = await addManualWordSense("word-banco", { translation: "  BANCO (Instituição) " }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(LearningStateError);
    expect((error as LearningStateError).status).toBe(409);
    expect((error as LearningStateError).message).toContain("já existe");
    expect(createRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("rejects duplicates against legacy non-normalized stored sense keys", async () => {
    const legacyKeySenses: TeableRecord<WordSenseFields>[] = [{
      id: "sense-legacy",
      fields: {
        user_id: user.id,
        word_id: "word-banco",
        sense_key: JSON.stringify([user.id, profile.id, "Bânco", "Banco (Instituição)"]),
        translation: "banco (instituição)",
        sense_order: 1
      }
    }];
    mockWordEnvironment([bancoWord], legacyKeySenses);
    const { addManualWordSense } = await import("../../lib/learning/words");

    const error = await addManualWordSense("word-banco", { translation: "banco (instituição)" }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(LearningStateError);
    expect((error as LearningStateError).status).toBe(409);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("rejects an empty translation with a 422 before hitting storage", async () => {
    mockWordEnvironment([bancoWord], bancoSenses);
    const { addManualWordSense } = await import("../../lib/learning/words");

    const error = await addManualWordSense("word-banco", { translation: "   " }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(LearningStateError);
    expect((error as LearningStateError).status).toBe(422);
    expect(createRecord).not.toHaveBeenCalled();
    expect(listAllRecords).not.toHaveBeenCalled();
    expect(listRecordsWhereAll).not.toHaveBeenCalled();
    expect(listRecordsWhere).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown words or words outside the learner's scope", async () => {
    mockWordEnvironment([bancoWord], bancoSenses);
    const { addManualWordSense } = await import("../../lib/learning/words");

    const missing = await addManualWordSense("word-missing", { translation: "x" }).catch((failure: unknown) => failure);
    expect(missing).toBeInstanceOf(LearningStateError);
    expect((missing as LearningStateError).status).toBe(404);
    expect(createRecord).not.toHaveBeenCalled();
  });
});
