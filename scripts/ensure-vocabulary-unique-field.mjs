import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

async function main() {
  const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const env = readEnv(option("--env") ?? ".env.local");
  const apply = process.argv.includes("--apply");
  const specifications = [
    { envName: "TEABLE_WORDS_TABLE_ID", name: "canonical_key", description: "Atomic uniqueness key: user, language profile and normalized lemma." },
    { envName: "TEABLE_WORD_OCCURRENCES_TABLE_ID", name: "occurrence_key", description: "Atomic uniqueness key: conversation, message, token and ordinal." }
  ];
  const results = [];
  for (const specification of specifications) {
    const tableId = required(env, specification.envName);
    const fields = await teableRequest(env, `/api/table/${tableId}/field`);
    const existing = Array.isArray(fields) ? fields.find((field) => field?.name === specification.name) : undefined;
    if (existing && existing.unique !== true) throw new Error(`${specification.name} já existe sem unicidade.`);
    let created = null;
    if (!existing && apply) {
      created = await teableRequest(env, `/api/table/${tableId}/field`, {
        method: "POST",
        body: JSON.stringify({ type: "singleLineText", name: specification.name, unique: true, notNull: false, description: specification.description })
      });
    }
    results.push({ table: specification.envName, name: specification.name, fieldExists: Boolean(existing || created), unique: (existing || created)?.unique === true, fieldId: (existing || created)?.id ?? null, action: existing ? "none" : apply ? "created" : "create-required" });
  }
  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    fields: results
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
