import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSchemaTable } from "../../lib/teable/schema";
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
import { TeableConfigError, type TeableRecord } from "../../lib/teable/client";
import type { WordSenseFields } from "../../lib/learning/conversations";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const WORD_SENSE_FIELDS: Array<[string, string]> = [
  ["word_id", "relation"],
  ["sense_key", "text"],
  ["translation", "text"],
  ["part_of_speech", "text"],
  ["example_sentence", "longText"],
  ["source", "singleSelect"],
  ["is_primary", "checkbox"],
  ["sense_order", "number"],
  ["review_due_at", "date"],
  ["review_interval_days", "number"],
  ["review_ease", "number"],
  ["review_streak", "number"],
  ["lapse_count", "number"],
  ["learning_step", "number"],
  ["last_reviewed_at", "date"],
  ["last_rating", "singleSelect"],
  ["average_response_time_ms", "number"],
  ["review_state", "singleSelect"],
  ["review_version", "text"],
  ["leech_flagged_at", "date"],
  ["created_at", "date"]
];

describe("word senses schema contract", () => {
  it("exposes the full wordSenses table definition via getSchemaTable", () => {
    const table = getSchemaTable("wordSenses");

    expect(table).toBeDefined();
    expect(table?.envName).toBe("TEABLE_WORD_SENSES_TABLE_ID");
    expect(table?.displayName).toBe("WordSenses");
    expect(table?.fields.map((field) => [field.name, field.type])).toEqual(WORD_SENSE_FIELDS);
  });

  it("registers TEABLE_WORD_SENSES_TABLE_ID in .env.example", () => {
    expect(read(".env.example")).toContain("TEABLE_WORD_SENSES_TABLE_ID=");
  });

  it("registers the npm scripts for table setup and backfill", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["senses:ensure-table"]).toBe("node scripts/ensure-word-senses-table.mjs");
    expect(packageJson.scripts["senses:backfill"]).toBe("node scripts/backfill-word-senses.mjs");
    expect(packageJson.scripts["senses:backfill:apply"]).toBe("node scripts/backfill-word-senses.mjs --apply");
  });

  it("creates an idempotent table setup script with dry-run default", () => {
    const ensure = read("scripts/ensure-word-senses-table.mjs");

    expect(ensure).toContain("--apply");
    expect(ensure).toContain('name: "sense_key", unique: true');
    for (const [name] of WORD_SENSE_FIELDS) {
      expect(ensure).toContain(`"${name}"`);
    }
  });
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
    expect(matchesCanonicalSenseKey(canonicalSenseKey("user-2", "profile-1", "banco", "bank"), key)).toBe(false);
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
    fields: { word_id: "word-1", translation: `tr-${id}`, ...fields }
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

describe("word senses access layer", () => {
  const ENV_KEYS = ["TEABLE_BASE_URL", "TEABLE_API_KEY", "TEABLE_WORD_SENSES_TABLE_ID"];
  const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const fetchMock = vi.fn();

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const senseRecord = (id: string, fields: Partial<WordSenseFields>): TeableRecord<WordSenseFields> => ({
    id,
    fields: { word_id: "word-1", translation: `tr-${id}`, ...fields }
  });

  beforeEach(() => {
    process.env.TEABLE_BASE_URL = "https://teable.example";
    process.env.TEABLE_API_KEY = "test-token";
    process.env.TEABLE_WORD_SENSES_TABLE_ID = "tblWordSenses";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("groups senses by parent word id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          senseRecord("s1", { word_id: "word-1", is_primary: true }),
          senseRecord("s2", { word_id: "word-2" }),
          senseRecord("s3", { word_id: "word-1" })
        ]
      })
    );

    const byWord = await listSensesByWordIds(["word-1", "word-2"]);

    expect([...byWord.keys()].sort()).toEqual(["word-1", "word-2"]);
    expect(byWord.get("word-1")?.map((record) => record.id)).toEqual(["s1", "s3"]);
    expect(byWord.get("word-2")?.map((record) => record.id)).toEqual(["s2"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/table/tblWordSenses/record?");
  });

  it("does not hit Teable when no word ids are given", async () => {
    const byWord = await listSensesByWordIds([]);
    expect(byWord.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to an empty map with one warning when the wordSenses table is not configured", async () => {
    delete process.env.TEABLE_WORD_SENSES_TABLE_ID;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const byWord = await listSensesByWordIds(["word-1", "word-2"]);

    expect(byWord.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("TEABLE_WORD_SENSES_TABLE_ID");
    warn.mockRestore();
  });

  it("propagates other Teable errors instead of degrading", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    await expect(listSensesByWordIds(["word-1"])).rejects.toMatchObject({ status: 500 });
  });

  it("propagates non-table config errors (e.g. missing base URL)", async () => {
    delete process.env.TEABLE_BASE_URL;

    await expect(listSensesByWordIds(["word-1"])).rejects.toBeInstanceOf(TeableConfigError);
  });

  it("finds a sense by key, matching legacy non-normalized stored keys", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [senseRecord("s1", { sense_key: JSON.stringify(["user-1", "profile-1", "Café", "Bänk"]) })]
      })
    );

    const found = await findSenseByKey(canonicalSenseKey("user-1", "profile-1", "cafe", "bank"));
    expect(found?.id).toBe("s1");

    fetchMock.mockResolvedValue(jsonResponse({ records: [] }));
    await expect(findSenseByKey(canonicalSenseKey("user-1", "profile-1", "cafe", "bank"))).resolves.toBeUndefined();
  });

  it("returns the primary sense, falling back to the lowest sense_order", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [senseRecord("s2", { word_id: "word-1", is_primary: true, sense_order: 2 }), senseRecord("s1", { word_id: "word-1", sense_order: 1 })] }));
    await expect(getPrimarySense("word-1")).resolves.toMatchObject({ id: "s2" });

    fetchMock.mockResolvedValue(jsonResponse({ records: [senseRecord("s2", { word_id: "word-1", sense_order: 2 }), senseRecord("s1", { word_id: "word-1", sense_order: 1 })] }));
    await expect(getPrimarySense("word-1")).resolves.toMatchObject({ id: "s1" });

    fetchMock.mockResolvedValue(jsonResponse({ records: [] }));
    await expect(getPrimarySense("word-1")).resolves.toBeUndefined();
  });

  it("creates a sense and returns the created record", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [senseRecord("s1", { translation: "bank" })] }));

    const created = await createWordSense({ word_id: "word-1", translation: "bank", is_primary: true });

    expect(created.id).toBe("s1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/table/tblWordSenses/record?fieldKeyType=name");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ records: [{ fields: { word_id: "word-1", translation: "bank", is_primary: true } }] });
  });

  it("re-reads by sense_key and returns the existing sense on a uniqueness conflict", async () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "duplicate" }, 409))
      .mockResolvedValueOnce(jsonResponse({ records: [senseRecord("s-existing", { sense_key: key })] }));

    const created = await createWordSense({ word_id: "word-1", sense_key: key, translation: "bank" });

    expect(created.id).toBe("s-existing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows the create error when the conflicting sense cannot be found", async () => {
    const key = canonicalSenseKey("user-1", "profile-1", "banco", "bank");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "duplicate" }, 422))
      .mockResolvedValueOnce(jsonResponse({ records: [] }));

    await expect(createWordSense({ word_id: "word-1", sense_key: key, translation: "bank" })).rejects.toMatchObject({ status: 422 });
  });

  it("rethrows non-conflict create errors without re-reading", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    await expect(createWordSense({ word_id: "word-1", translation: "bank" })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates a sense", async () => {
    fetchMock.mockResolvedValue(jsonResponse(senseRecord("s1", { review_streak: 7 })));

    const updated = await updateWordSense("s1", { review_streak: 7 });

    expect(updated.fields.review_streak).toBe(7);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/table/tblWordSenses/record/s1?");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ record: { fields: { review_streak: 7 } } });
  });
});

describe("backfill word senses planner", () => {
  const NOW = "2026-08-12T00:00:00.000Z";
  const word = (id: string, fields: Record<string, unknown>) => ({ id, fields });
  const baseFields = {
    user_id: "user-1",
    language_profile_id: "profile-1",
    lemma: "banco",
    translation: "bank",
    part_of_speech: "noun",
    review_due_at: "2026-08-10T00:00:00.000Z",
    review_streak: 4,
    lapse_count: 1,
    last_rating: "good",
    review_state: "review"
  };

  it("creates one primary sense per word with translation, copying the SRS state", async () => {
    const { buildWordSenseBackfillPlan } = await import("../../scripts/backfill-word-senses.mjs");
    const plan = buildWordSenseBackfillPlan([word("word-1", baseFields)], [], NOW);

    expect(plan.skippedExisting).toBe(0);
    expect(plan.skippedNoTranslation).toBe(0);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].fields).toEqual({
      Name: "banco",
      word_id: "word-1",
      sense_key: canonicalSenseKey("user-1", "profile-1", "banco", "bank"),
      translation: "bank",
      part_of_speech: "noun",
      source: "backfill",
      is_primary: true,
      sense_order: 1,
      review_due_at: "2026-08-10T00:00:00.000Z",
      review_streak: 4,
      lapse_count: 1,
      last_rating: "good",
      review_state: "review",
      created_at: NOW
    });
  });

  it("skips words without translation", async () => {
    const { buildWordSenseBackfillPlan } = await import("../../scripts/backfill-word-senses.mjs");
    const plan = buildWordSenseBackfillPlan(
      [word("w1", { ...baseFields, translation: "" }), word("w2", { ...baseFields, translation: "  " }), word("w3", { ...baseFields, translation: undefined })],
      [],
      NOW
    );

    expect(plan.creates).toHaveLength(0);
    expect(plan.skippedNoTranslation).toBe(3);
  });

  it("is idempotent: skips words whose sense_key already exists, even legacy non-normalized", async () => {
    const { buildWordSenseBackfillPlan } = await import("../../scripts/backfill-word-senses.mjs");
    const existing = [
      { id: "s1", fields: { sense_key: JSON.stringify(["user-1", "profile-1", "Bânco", "Bank"]) } },
      { id: "s2", fields: { sense_key: canonicalSenseKey("user-1", "profile-1", "casa", "house") } }
    ];
    const plan = buildWordSenseBackfillPlan(
      [word("word-1", baseFields), word("word-2", { ...baseFields, lemma: "casa", translation: "house" }), word("word-3", { ...baseFields, lemma: "gato", translation: "cat" })],
      existing,
      NOW
    );

    expect(plan.creates.map((item: { wordId: string }) => item.wordId)).toEqual(["word-3"]);
    expect(plan.skippedExisting).toBe(2);
  });

  it("does not plan two senses with the same key in a single run", async () => {
    const { buildWordSenseBackfillPlan } = await import("../../scripts/backfill-word-senses.mjs");
    const plan = buildWordSenseBackfillPlan(
      [word("word-1", baseFields), word("word-2", { ...baseFields, lemma: "Banco", translation: "Bank" })],
      [],
      NOW
    );

    expect(plan.creates).toHaveLength(1);
    expect(plan.skippedExisting).toBe(1);
  });
});
