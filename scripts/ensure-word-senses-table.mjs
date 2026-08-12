import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const TABLE_NAME = "WordSenses";
const TABLE_ENV_NAME = "TEABLE_WORD_SENSES_TABLE_ID";

// Mirrors lib/teable/schema.ts ("wordSenses"). Relation fields follow the repo
// pattern from setup-teable-schema.mjs: they are singleLineText columns holding
// the related record id.
const FIELD_PLAN = [
  { type: "singleLineText", name: "word_id", description: "Relation to Words (parent word of this sense)." },
  { type: "singleLineText", name: "sense_key", unique: true, description: "Unique user + language profile + lemma + normalized translation key." },
  { type: "singleLineText", name: "translation" },
  { type: "singleLineText", name: "part_of_speech" },
  { type: "longText", name: "example_sentence" },
  { type: "singleSelect", name: "source", options: { choices: [
    { name: "chat", color: "greenBright" },
    { name: "manual", color: "blueBright" },
    { name: "backfill", color: "grayBright" }
  ] } },
  { type: "checkbox", name: "is_primary" },
  { type: "number", name: "sense_order", description: "1-based display order; primary is 1." },
  { type: "date", name: "review_due_at" },
  { type: "number", name: "review_interval_days" },
  { type: "number", name: "review_ease" },
  { type: "number", name: "review_streak" },
  { type: "number", name: "lapse_count" },
  { type: "number", name: "learning_step" },
  { type: "date", name: "last_reviewed_at" },
  { type: "singleSelect", name: "last_rating", options: { choices: [
    { name: "forgot", color: "redBright" },
    { name: "hard", color: "yellowBright" },
    { name: "good", color: "greenBright" },
    { name: "easy", color: "blueBright" }
  ] } },
  { type: "number", name: "average_response_time_ms" },
  { type: "singleSelect", name: "review_state", options: { choices: [
    { name: "new", color: "grayBright" },
    { name: "learning", color: "yellowBright" },
    { name: "review", color: "greenBright" },
    { name: "difficult", color: "redBright" },
    { name: "suspended", color: "purpleBright" }
  ] } },
  { type: "singleLineText", name: "review_version" },
  { type: "date", name: "leech_flagged_at" },
  { type: "date", name: "created_at" }
];

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const envPath = option("--env") ?? ".env.local";
  const env = readEnv(envPath);
  const apply = process.argv.includes("--apply");

  let tableId = env[TABLE_ENV_NAME]?.trim();
  let foundByName = false;
  if (!tableId) {
    const baseId = required(env, "TEABLE_BASE_ID");
    const tables = await teableRequest(env, `/api/base/${baseId}/table`);
    tableId = tables.find((table) => table?.name === TABLE_NAME)?.id;
    foundByName = Boolean(tableId);
  }

  if (!tableId && apply) {
    const created = await teableRequest(env, `/api/base/${required(env, "TEABLE_BASE_ID")}/table`, {
      method: "POST",
      body: JSON.stringify({ name: TABLE_NAME })
    });
    tableId = created.id;
    updateEnvFile(envPath, TABLE_ENV_NAME, tableId);
  } else if (foundByName && apply) {
    updateEnvFile(envPath, TABLE_ENV_NAME, tableId);
  }

  if (!tableId) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      table: TABLE_NAME,
      tableId: null,
      action: "create-table-required",
      fields: FIELD_PLAN.map((field) => ({ table: TABLE_ENV_NAME, name: field.name, fieldExists: false, fieldId: null, action: "create-required" }))
    }, null, 2));
    return;
  }

  const existing = await teableRequest(env, `/api/table/${tableId}/field`);
  const existingByName = new Map((Array.isArray(existing) ? existing : []).map((field) => [field?.name, field]));
  const report = [];

  for (const field of FIELD_PLAN) {
    const existingField = existingByName.get(field.name);
    let created = null;
    if (!existingField && apply) {
      created = await teableRequest(env, `/api/table/${tableId}/field`, {
        method: "POST",
        body: JSON.stringify({ ...field, notNull: false })
      });
    }
    const resolved = existingField ?? created;
    report.push({
      table: TABLE_ENV_NAME,
      name: field.name,
      fieldExists: Boolean(resolved),
      fieldId: resolved?.id ?? null,
      action: existingField ? "none" : apply ? "created" : "create-required"
    });
  }

  console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", table: TABLE_NAME, tableId, fields: report }, null, 2));
}

function updateEnvFile(path, key, value) {
  const original = fs.readFileSync(path, "utf8");
  const next = new RegExp(`^${key}=`, "m").test(original)
    ? original.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
    : `${original}${original.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  fs.writeFileSync(path, next);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
