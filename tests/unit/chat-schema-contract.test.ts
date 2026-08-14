import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("chat v2 schema contract", () => {
  const migration = read("supabase/migrations/0001_initial_schema.sql");

  it("registers interaction_mode, target_user_message_count and channel in the Supabase schema", () => {
    expect(migration).toContain("interaction_mode");
    expect(migration).toContain("target_user_message_count");
    expect(migration).toContain("channel");
  });
});
