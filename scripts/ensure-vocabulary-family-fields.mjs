import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const env = readEnv(option("--env") ?? ".env.local");
  const apply = process.argv.includes("--apply");
  const tableId = required(env, "TEABLE_WORDS_TABLE_ID");
  const fields = await teableRequest(env, `/api/table/${tableId}/field`);
  const existing = Array.isArray(fields) ? fields.find((field) => field?.name === "forms_json") : undefined;
  let created = null;

  if (!existing && apply) {
    created = await teableRequest(env, `/api/table/${tableId}/field`, {
      method: "POST",
      body: JSON.stringify({
        type: "longText",
        name: "forms_json",
        notNull: false,
        description: "JSON array of observed inflected forms grouped under the canonical lemma."
      })
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    field: {
      table: "TEABLE_WORDS_TABLE_ID",
      name: "forms_json",
      fieldExists: Boolean(existing || created),
      fieldId: (existing || created)?.id ?? null,
      action: existing ? "none" : apply ? "created" : "create-required"
    }
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
