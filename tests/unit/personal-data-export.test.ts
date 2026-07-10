import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPersonalDataExportFileName, PERSONAL_DATA_EXPORT_SCHEMA_VERSION } from "../../lib/learning/export";

describe("personal data export", () => {
  it("versions the schema and names the file with language and date", () => {
    expect(PERSONAL_DATA_EXPORT_SCHEMA_VERSION).toBe(1);
    expect(buildPersonalDataExportFileName("pt-BR", new Date("2026-07-10T12:00:00.000Z")))
      .toBe("ai-fluency-pt-br-2026-07-10.json");
    expect(buildPersonalDataExportFileName(undefined, new Date("2026-07-10T12:00:00.000Z")))
      .toBe("ai-fluency-sem-idioma-2026-07-10.json");
  });

  it("keeps provider secrets and private cache paths outside the export contract", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const accountSource = fs.readFileSync(path.join(root, "lib/learning/account.ts"), "utf8");
    const forbidden = ["TEABLE_ACCESS_TOKEN", "OPENAI_API_KEY", "AI_API_KEY", "KOKORO_API_KEY", "AUDIO_CACHE_DIR"];
    for (const name of forbidden) expect(accountSource).not.toContain(name);
  });
});
