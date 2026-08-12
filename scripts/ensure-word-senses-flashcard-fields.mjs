import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

// Mirrors lib/teable/schema.ts: flashcards.target_sense_id and
// flashcardAttempts.sense_id. Relation fields follow the repo pattern from
// setup-teable-schema.mjs: they are singleLineText columns holding the related
// record id.
const FIELD_PLAN = [
  {
    envName: "TEABLE_FLASHCARDS_TABLE_ID",
    fields: [
      { type: "singleLineText", name: "target_sense_id", description: "Relation to WordSenses: the sense exercised by this frozen card. Blank on legacy cards — their reviews keep updating the word directly." }
    ]
  },
  {
    envName: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
    fields: [
      { type: "singleLineText", name: "sense_id", description: "Relation to WordSenses: the sense reviewed by this attempt. Blank on legacy word-level attempts." }
    ]
  }
];

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const env = readEnv(option("--env") ?? ".env.local");
  const apply = process.argv.includes("--apply");
  const report = [];

  for (const table of FIELD_PLAN) {
    const tableId = required(env, table.envName);
    const existing = await teableRequest(env, `/api/table/${tableId}/field`);
    const existingNames = new Set((Array.isArray(existing) ? existing : []).map((field) => field?.name));
    for (const field of table.fields) {
      const exists = existingNames.has(field.name);
      let created = null;
      if (!exists && apply) {
        created = await teableRequest(env, `/api/table/${tableId}/field`, {
          method: "POST",
          body: JSON.stringify({ ...field, notNull: false })
        });
      }
      report.push({
        table: table.envName,
        name: field.name,
        fieldExists: exists || Boolean(created),
        fieldId: created?.id ?? null,
        action: exists ? "none" : apply ? "created" : "create-required"
      });
    }
  }

  console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", fields: report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
