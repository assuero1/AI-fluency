import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSchemaTable } from "../../lib/teable/schema";
import { resolveDueSenses } from "../../lib/learning/word-senses";
import { calculateAdaptiveReview, reviewToSenseFields, reviewToWordFields } from "../../lib/learning/spaced-repetition";
import type { WordFields, WordSenseFields } from "../../lib/learning/conversations";
import type { TeableRecord } from "../../lib/teable/client";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const NOW = new Date("2026-08-12T12:00:00.000Z");

function word(id: string, fields: Partial<WordFields>): TeableRecord<WordFields> {
  return { id, fields: fields as WordFields };
}

function sense(id: string, wordId: string, fields: Partial<WordSenseFields>): TeableRecord<WordSenseFields> {
  return { id, fields: { word_id: wordId, translation: `tr-${id}`, ...fields } as WordSenseFields };
}

describe("word senses flashcard fields schema contract", () => {
  it("registers target_sense_id on the flashcards table", () => {
    const table = getSchemaTable("flashcards");

    expect(table).toBeDefined();
    const field = table?.fields.find((item) => item.name === "target_sense_id");
    expect(field).toMatchObject({ name: "target_sense_id", type: "relation", note: "WordSenses" });
  });

  it("registers sense_id on the flashcardAttempts table", () => {
    const table = getSchemaTable("flashcardAttempts");

    expect(table).toBeDefined();
    const field = table?.fields.find((item) => item.name === "sense_id");
    expect(field).toMatchObject({ name: "sense_id", type: "relation", note: "WordSenses" });
  });

  it("creates an idempotent field setup script with dry-run default", () => {
    const ensure = read("scripts/ensure-word-senses-flashcard-fields.mjs");

    expect(ensure).toContain("--apply");
    expect(ensure).toContain("TEABLE_FLASHCARDS_TABLE_ID");
    expect(ensure).toContain("TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID");
    expect(ensure).toContain('"target_sense_id"');
    expect(ensure).toContain('"sense_id"');
  });

  it("registers the npm script for the flashcard sense fields", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["senses:flashcard-fields"]).toBe("node scripts/ensure-word-senses-flashcard-fields.mjs");
  });
});

describe("resolveDueSenses", () => {
  it("synthesizes a legacy sense from the word SRS cache when the word has no senses", () => {
    const legacy = word("word-legacy", {
      user_id: "user-a",
      language_profile_id: "profile-a",
      lemma: "hola",
      translation: "olá",
      review_due_at: "2026-08-10T09:00:00.000Z",
      review_state: "review",
      review_streak: 5
    });

    const [entry] = resolveDueSenses([legacy], new Map(), NOW);

    expect(entry.word).toBe(legacy);
    expect(entry.synthetic).toBe(true);
    expect(entry.sense.id).toBe("");
    expect(entry.sense.fields).toMatchObject({
      word_id: "word-legacy",
      translation: "olá",
      is_primary: true,
      review_due_at: "2026-08-10T09:00:00.000Z",
      review_state: "review",
      review_streak: 5
    });
  });

  it("picks the most-due sense of the word (min review_due_at among due senses)", () => {
    const target = word("word-a", { lemma: "banco", translation: "banco" });
    const senses = new Map([
      ["word-a", [
        sense("sense-late", "word-a", { review_due_at: "2026-08-11T09:00:00.000Z", translation: "banco (assento)" }),
        sense("sense-early", "word-a", { review_due_at: "2026-08-01T09:00:00.000Z", translation: "banco (instituição)" })
      ]]
    ]);

    const [entry] = resolveDueSenses([target], senses, NOW);

    expect(entry.synthetic).toBe(false);
    expect(entry.sense.id).toBe("sense-early");
  });

  it("prefers a due sense over a not-yet-due sense of the same word", () => {
    const target = word("word-a", { lemma: "banco" });
    const senses = new Map([
      ["word-a", [
        sense("sense-future", "word-a", { review_due_at: "2026-08-20T09:00:00.000Z" }),
        sense("sense-due", "word-a", { review_due_at: "2026-08-12T09:00:00.000Z" })
      ]]
    ]);

    const [entry] = resolveDueSenses([target], senses, NOW);

    expect(entry.sense.id).toBe("sense-due");
  });

  it("falls back to the closest upcoming sense when no sense is due yet", () => {
    const target = word("word-a", { lemma: "banco" });
    const senses = new Map([
      ["word-a", [
        sense("sense-far", "word-a", { review_due_at: "2026-08-30T09:00:00.000Z" }),
        sense("sense-near", "word-a", { review_due_at: "2026-08-15T09:00:00.000Z" })
      ]]
    ]);

    const [entry] = resolveDueSenses([target], senses, NOW);

    expect(entry.sense.id).toBe("sense-near");
  });

  it("treats a sense without review_due_at as due first (like a new card)", () => {
    const target = word("word-a", { lemma: "banco" });
    const senses = new Map([
      ["word-a", [
        sense("sense-scheduled", "word-a", { review_due_at: "2026-08-01T09:00:00.000Z" }),
        sense("sense-new", "word-a", { review_state: "new" })
      ]]
    ]);

    const [entry] = resolveDueSenses([target], senses, NOW);

    expect(entry.sense.id).toBe("sense-new");
  });

  it("skips suspended senses while the word still has active ones", () => {
    const target = word("word-a", { lemma: "banco" });
    const senses = new Map([
      ["word-a", [
        sense("sense-suspended", "word-a", { review_state: "suspended", review_due_at: "2026-08-01T09:00:00.000Z" }),
        sense("sense-active", "word-a", { review_state: "review", review_due_at: "2026-08-11T09:00:00.000Z" })
      ]]
    ]);

    const [entry] = resolveDueSenses([target], senses, NOW);

    expect(entry.sense.id).toBe("sense-active");
  });

  it("resolves one entry per word, preserving the input order", () => {
    const words = [word("word-a", { lemma: "a" }), word("word-b", { lemma: "b" }), word("word-c", { lemma: "c" })];
    const senses = new Map([["word-b", [sense("sense-b", "word-b", { review_due_at: "2026-08-01T09:00:00.000Z" })]]]);

    const resolved = resolveDueSenses(words, senses, NOW);

    expect(resolved.map((entry) => entry.word.id)).toEqual(["word-a", "word-b", "word-c"]);
    expect(resolved.map((entry) => entry.synthetic)).toEqual([true, false, true]);
    expect(resolved[1].sense.id).toBe("sense-b");
  });
});

describe("reviewToSenseFields", () => {
  it("mirrors reviewToWordFields minus familiarity_score (wordSenses has no such column)", () => {
    const review = calculateAdaptiveReview(
      { review_state: "review", learning_step: 3, review_interval_days: 7, review_ease: 2.3, review_streak: 2 },
      [{ rating: "good", responseTimeMs: 2_000, cardType: "target_to_native" }],
      new Date("2026-08-12T12:00:00.000Z"),
      "UTC",
      "sense-seed"
    );

    const wordFields = reviewToWordFields(review);
    const senseFields = reviewToSenseFields(review);
    const expected = Object.fromEntries(Object.entries(wordFields).filter(([key]) => key !== "familiarity_score"));

    expect(senseFields).toEqual(expected);
    expect(senseFields).not.toHaveProperty("familiarity_score");
    expect(senseFields).toMatchObject({
      review_due_at: review.reviewDueAt,
      last_rating: "good",
      review_state: "review",
      review_version: "srs-v2"
    });
  });

  it("omits leech_flagged_at unless the review flags a leech", () => {
    const clean = reviewToSenseFields(calculateAdaptiveReview({ review_state: "new" }, [{ rating: "good", responseTimeMs: 1_000 }], new Date("2026-08-12T12:00:00.000Z"), "UTC", "seed-a"));
    expect(clean).not.toHaveProperty("leech_flagged_at");

    const leech = reviewToSenseFields(calculateAdaptiveReview(
      { review_state: "review", learning_step: 3, lapse_count: 4, leech_flagged_at: "2026-08-01T09:00:00.000Z" },
      [{ rating: "hard", responseTimeMs: 9_000 }],
      new Date("2026-08-12T12:00:00.000Z"),
      "UTC",
      "seed-b"
    ));
    expect(leech.leech_flagged_at).toBe("2026-08-01T09:00:00.000Z");
  });
});
