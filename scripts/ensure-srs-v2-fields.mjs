import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const FIELD_PLAN = [
  {
    envName: "TEABLE_WORDS_TABLE_ID",
    fields: [
      { type: "number", name: "learning_step", description: "SRS v2: current learning/relearning step index (step count + 1 when graduated)." },
      { type: "date", name: "implicit_review_at", description: "SRS v2: last implicit review credited from correct conversation use." },
      { type: "date", name: "leech_flagged_at", description: "SRS v2: when the word crossed the leech lapse threshold." }
    ]
  },
  {
    envName: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
    fields: [
      { type: "checkbox", name: "review_applied", description: "SRS v2: whether the incremental SRS update for this attempt was persisted to the word." },
      { type: "singleLineText", name: "resulting_review_state", description: "SRS v2: review state resulting from the incremental update (audit)." }
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
