import { describe, expect, it } from "vitest";
import tablesJson from "@/lib/supabase/tables.json";
import { teableSchema } from "@/lib/teable/schema";

const tables = tablesJson.tables as Array<{
  key: string;
  tableName: string;
  jsonbColumns: string[];
  fkColumns: Record<string, string>;
  hasCreatedAt: boolean;
}>;

describe("lib/supabase/tables.json", () => {
  it("covers every TeableTableKey exactly once", () => {
    expect(tables.map((t) => t.key).sort()).toEqual(teableSchema.map((t) => t.key).sort());
  });

  it("uses unique snake_case table names", () => {
    const names = tables.map((t) => t.tableName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("only marks Teable json fields as jsonb columns", () => {
    for (const meta of tables) {
      const teableTable = teableSchema.find((t) => t.key === meta.key)!;
      const jsonFields = teableTable.fields.filter((f) => f.type === "json").map((f) => f.name);
      for (const column of meta.jsonbColumns) {
        // review_snapshot (flashcardAttempts) foi adicionado por ensure-flashcard-undo-fields
        // e não consta em teableSchema; é o único jsonb fora da lista.
        if (meta.key === "flashcardAttempts" && column === "review_snapshot") continue;
        expect(jsonFields).toContain(column);
      }
      for (const field of jsonFields) {
        expect(meta.jsonbColumns).toContain(field);
      }
    }
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
