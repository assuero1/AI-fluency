import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WordFields } from "../../lib/learning/conversations";
import {
  aggregateSenseReviewToWordFields,
  canonicalSenseKey,
  createWordSense,
  findSenseByKey,
  getPrimarySense,
  listSensesByWordIds,
  matchesCanonicalSenseKey,
  synthesizeLegacySense,
  updateWordSense
} from "../../lib/learning/word-senses";
import { TeableRequestError, type TeableRecord } from "../../lib/supabase/client";
import type { WordSenseFields } from "../../lib/learning/conversations";

const clientFns = vi.hoisted(() => ({
  listRecordsWhere: vi.fn(),
  listRecordsWhereAll: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn()
}));

vi.mock("../../lib/supabase/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/supabase/client")>();
  return { ...original, getTeableClient: () => clientFns };
});

describe("canonicalSenseKey / matchesCanonicalSenseKey", () => {
  it("builds a JSON-array key with normalized lemma and translation", () => {
    expect(canonicalSenseKey("user-1", "profile-1", "Café", "  Café da Manhã ")).toBe(
      JSON.stringify(["user-1", "profile-1", "cafe", "cafe da manha"])
    );
  });

  it("matches identical keys", () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    expect(matchesCanonicalSenseKey(key, key)).toBe(true);
  });

  it("matches a legacy stored key whose parts were not normalized", () => {
    const storedKey = JSON.stringify(["user-1", "profile-1", "Café", "Bänk"]);
    expect(matchesCanonicalSenseKey(storedKey, canonicalSenseKey("user-1", "profile-1", "cafe", "bank"))).toBe(true);
  });

  it("rejects missing, malformed or different keys", () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    expect(matchesCanonicalSenseKey(undefined, key)).toBe(false);
    expect(matchesCanonicalSenseKey("not json", key)).toBe(false);
    expect(matchesCanonicalSenseKey(JSON.stringify(["user-1", "profile-1", "banco"]), key)).toBe(false);
    expect(matchesCanonicalSenseKey(canonicalSenseKey("user-1", "profile-1", "banco", "bench"), key)).toBe(false);
    expect(matchesCanonicalSenseKey(canonicalSenseKey("user-2", "profile-1", "cafe", "bank"), key)).toBe(false);
  });
});

describe("synthesizeLegacySense", () => {
  const word: TeableRecord<WordFields> = {
    id: "word-1",
    fields: {
      user_id: "user-1",
      language_profile_id: "profile-1",
      lemma: "banco",
      display_text: "banco",
      translation: "bank",
      part_of_speech: "noun",
      familiarity_score: 3,
      total_uses: 5,
      last_used_at: "2026-08-01T00:00:00.000Z",
      first_used_at: "2026-07-01T00:00:00.000Z",
      review_due_at: "2026-08-10T00:00:00.000Z",
      review_interval_days: 6,
      review_ease: 2.4,
      review_streak: 4,
      lapse_count: 1,
      learning_step: 2,
      last_reviewed_at: "2026-08-04T00:00:00.000Z",
      last_rating: "good",
      average_response_time_ms: 3100,
      review_state: "review",
      review_version: "srs-v2",
      leech_flagged_at: "2026-08-05T00:00:00.000Z"
    }
  };

  it("builds a synthetic primary sense from the word, copying the SRS state", () => {
    expect(synthesizeLegacySense(word)).toEqual({
      user_id: "user-1",
      word_id: "word-1",
      sense_key: canonicalSenseKey("user-1", "profile-1", "banco", "bank"),
      translation: "bank",
      part_of_speech: "noun",
      is_primary: true,
      sense_order: 1,
      review_due_at: "2026-08-10T00:00:00.000Z",
      review_interval_days: 6,
      review_ease: 2.4,
      review_streak: 4,
      lapse_count: 1,
      learning_step: 2,
      last_reviewed_at: "2026-08-04T00:00:00.000Z",
      last_rating: "good",
      average_response_time_ms: 3100,
      review_state: "review",
      review_version: "srs-v2",
      leech_flagged_at: "2026-08-05T00:00:00.000Z"
    });
  });

  it("omits sense_key when the word has no translation", () => {
    const sense = synthesizeLegacySense({ id: "word-2", fields: { ...word.fields, translation: "" } });
    expect(sense.sense_key).toBeUndefined();
    expect(sense.translation).toBe("");
    expect(sense.is_primary).toBe(true);
  });
});

describe("aggregateSenseReviewToWordFields", () => {
  const sense = (id: string, fields: Partial<WordSenseFields>): TeableRecord<WordSenseFields> => ({
    id,
    fields: { user_id: "user-1", word_id: "word-1", translation: `tr-${id}`, ...fields }
  });

  it("returns an empty partial for a word without senses", () => {
    expect(aggregateSenseReviewToWordFields([])).toEqual({});
  });

  it("takes the earliest review_due_at among non-suspended senses", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { review_due_at: "2026-08-20T00:00:00.000Z", review_state: "review" }),
      sense("b", { review_due_at: "2026-08-12T00:00:00.000Z", review_state: "learning" }),
      sense("c", { review_due_at: "2026-08-01T00:00:00.000Z", review_state: "suspended" })
    ]);
    expect(aggregated.review_due_at).toBe("2026-08-12T00:00:00.000Z");
  });

  it("picks the worst review state so weak senses stay visible in the queue", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { review_state: "review" }),
      sense("b", { review_state: "difficult" }),
      sense("c", { review_state: "learning" })
    ]);
    expect(aggregated.review_state).toBe("difficult");
  });

  it("reports suspended when every sense is suspended", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { review_state: "suspended" }),
      sense("b", { review_state: "suspended" })
    ]);
    expect(aggregated.review_state).toBe("suspended");
  });

  it("aggregates streak as min and lapses as sum", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { review_streak: 5, lapse_count: 2 }),
      sense("b", { review_streak: 1, lapse_count: 3 }),
      sense("c", {})
    ]);
    expect(aggregated.review_streak).toBe(0);
    expect(aggregated.lapse_count).toBe(5);
  });

  it("takes last_rating/last_reviewed_at from the most recently reviewed sense", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { last_reviewed_at: "2026-08-01T00:00:00.000Z", last_rating: "easy" }),
      sense("b", { last_reviewed_at: "2026-08-09T00:00:00.000Z", last_rating: "hard" }),
      sense("c", {})
    ]);
    expect(aggregated.last_reviewed_at).toBe("2026-08-09T00:00:00.000Z");
    expect(aggregated.last_rating).toBe("hard");
  });

  it("takes translation and part_of_speech from the primary sense", () => {
    const aggregated = aggregateSenseReviewToWordFields([
      sense("a", { translation: "bench", part_of_speech: "noun" }),
      sense("b", { translation: "bank", part_of_speech: "noun", is_primary: true })
    ]);
    expect(aggregated.translation).toBe("bank");
  });
});

describe("nextSenseOrderFromList", () => {
  it("computes the next sense_order from an in-memory list", async () => {
    const { nextSenseOrderFromList } = await import("../../lib/learning/word-senses");

    expect(nextSenseOrderFromList([])).toBe(1);
    expect(nextSenseOrderFromList([{ fields: { sense_order: 1 } }, { fields: { sense_order: 3 } }])).toBe(4);
    expect(nextSenseOrderFromList([{ fields: {} }])).toBe(1);
  });
});

describe("word senses access layer", () => {
  const senseRecord = (id: string, fields: Partial<WordSenseFields>): TeableRecord<WordSenseFields> => ({
    id,
    fields: { user_id: "user-1", word_id: "word-1", translation: `tr-${id}`, ...fields }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups senses by parent word id", async () => {
    clientFns.listRecordsWhere.mockImplementation(async (_table: string, _field: string, value: string) =>
      value === "word-1"
        ? [senseRecord("s1", { word_id: "word-1", is_primary: true }), senseRecord("s3", { word_id: "word-1" })]
        : [senseRecord("s2", { word_id: "word-2" })]
    );

    const byWord = await listSensesByWordIds(["word-1", "word-2"]);

    expect([...byWord.keys()].sort()).toEqual(["word-1", "word-2"]);
    expect(byWord.get("word-1")?.map((record) => record.id)).toEqual(["s1", "s3"]);
    expect(byWord.get("word-2")?.map((record) => record.id)).toEqual(["s2"]);
  });

  it("does not hit the backend when no word ids are given", async () => {
    const byWord = await listSensesByWordIds([]);
    expect(byWord.size).toBe(0);
    expect(clientFns.listRecordsWhere).not.toHaveBeenCalled();
  });

  it("propagates backend errors instead of degrading", async () => {
    clientFns.listRecordsWhere.mockRejectedValue(new TeableRequestError("boom", 500));

    await expect(listSensesByWordIds(["word-1"])).rejects.toMatchObject({ status: 500 });
  });

  it("finds a sense by key, matching legacy non-normalized stored keys", async () => {
    clientFns.listRecordsWhereAll.mockResolvedValue([
      senseRecord("s1", { sense_key: JSON.stringify(["user-1", "profile-1", "Café", "Bänk"]) })
    ]);

    const found = await findSenseByKey(canonicalSenseKey("user-1", "profile-1", "cafe", "bank"), "user-1");
    expect(found?.id).toBe("s1");

    clientFns.listRecordsWhereAll.mockResolvedValue([]);
    await expect(findSenseByKey(canonicalSenseKey("user-1", "profile-1", "cafe", "bank"), "user-1")).resolves.toBeUndefined();
  });

  it("returns the primary sense, falling back to the lowest sense_order", async () => {
    clientFns.listRecordsWhere.mockResolvedValue([
      senseRecord("s2", { word_id: "word-1", is_primary: true, sense_order: 2 }),
      senseRecord("s1", { word_id: "word-1", sense_order: 1 })
    ]);
    await expect(getPrimarySense("word-1")).resolves.toMatchObject({ id: "s2" });

    clientFns.listRecordsWhere.mockResolvedValue([
      senseRecord("s2", { word_id: "word-1", sense_order: 2 }),
      senseRecord("s1", { word_id: "word-1", sense_order: 1 })
    ]);
    await expect(getPrimarySense("word-1")).resolves.toMatchObject({ id: "s1" });

    clientFns.listRecordsWhere.mockResolvedValue([]);
    await expect(getPrimarySense("word-1")).resolves.toBeUndefined();
  });

  it("creates a sense and returns the created record", async () => {
    clientFns.createRecord.mockResolvedValue(senseRecord("s1", { translation: "bank" }));

    const created = await createWordSense({ user_id: "user-1", word_id: "word-1", translation: "bank", is_primary: true });

    expect(created.id).toBe("s1");
    expect(clientFns.createRecord).toHaveBeenCalledWith("wordSenses", {
      user_id: "user-1",
      word_id: "word-1",
      translation: "bank",
      is_primary: true
    });
  });

  it("re-reads by sense_key and returns the existing sense on a uniqueness conflict", async () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    clientFns.createRecord.mockRejectedValueOnce(new TeableRequestError("duplicate", 409));
    clientFns.listRecordsWhereAll.mockResolvedValueOnce([senseRecord("s-existing", { sense_key: key })]);

    const created = await createWordSense({ user_id: "user-1", word_id: "word-1", sense_key: key, translation: "bank" });

    expect(created.id).toBe("s-existing");
  });

  it("rethrows the create error when the conflicting sense cannot be found", async () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    clientFns.createRecord.mockRejectedValueOnce(new TeableRequestError("duplicate", 422));
    clientFns.listRecordsWhereAll.mockResolvedValueOnce([]);

    await expect(createWordSense({ user_id: "user-1", word_id: "word-1", sense_key: key, translation: "bank" })).rejects.toMatchObject({ status: 422 });
  });

  it("rethrows non-conflict create errors without re-reading", async () => {
    clientFns.createRecord.mockRejectedValue(new TeableRequestError("boom", 500));

    await expect(createWordSense({ user_id: "user-1", word_id: "word-1", translation: "bank" })).rejects.toMatchObject({ status: 500 });
    expect(clientFns.listRecordsWhereAll).not.toHaveBeenCalled();
  });

  it("updates a sense", async () => {
    clientFns.updateRecord.mockResolvedValue(senseRecord("s1", { review_streak: 7 }));

    const updated = await updateWordSense("s1", { review_streak: 7 });

    expect(updated.fields.review_streak).toBe(7);
    expect(clientFns.updateRecord).toHaveBeenCalledWith("wordSenses", "s1", { review_streak: 7 });
  });
});
