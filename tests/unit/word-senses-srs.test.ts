import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSchemaTable } from "../../lib/teable/schema";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

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
