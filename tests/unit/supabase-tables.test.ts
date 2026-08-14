import { describe, expect, it } from "vitest";
import tablesJson from "@/lib/supabase/tables.json";
import type { TeableTableKey } from "@/lib/supabase/tables";

const tables = tablesJson.tables as unknown as Array<{
  key: string;
  tableName: string;
  jsonbColumns: string[];
  fkColumns: Record<string, string>;
  hasCreatedAt: boolean;
}>;

// As 17 chaves históricas do antigo lib/teable/schema.ts — tables.json é agora
// a fonte única de TeableTableKey.
const EXPECTED_KEYS: TeableTableKey[] = [
  "users",
  "languageProfiles",
  "aiProviderSettings",
  "voiceProviderSettings",
  "conversations",
  "messages",
  "corrections",
  "words",
  "wordSenses",
  "wordOccurrences",
  "wordUsageSummaries",
  "dailyFeedbacks",
  "topics",
  "practiceSessions",
  "flashcards",
  "flashcardAttempts",
  "appEvents"
];

describe("lib/supabase/tables.json", () => {
  it("covers every TeableTableKey exactly once", () => {
    expect(tables.map((t) => t.key).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("uses unique snake_case table names", () => {
    const names = tables.map((t) => t.tableName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("fkColumns target existing table names", () => {
    const names = new Set(tables.map((t) => t.tableName));
    for (const meta of tables) {
      for (const target of Object.values(meta.fkColumns)) {
        expect(names.has(target)).toBe(true);
      }
    }
  });
});
