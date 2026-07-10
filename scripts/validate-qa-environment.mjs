import { assertQaEnvironment, readEnv, required, tableDefinitions, teableRequest } from "./qa-env.mjs";

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");
const env = readEnv(envPath);
assertQaEnvironment(env);
required(env, "TEABLE_BASE_URL");
required(env, "TEABLE_API_KEY", ["TEABLE_TOKEN"]);
required(env, "TEABLE_BASE_ID");
required(env, "AI_BASE_URL");
required(env, "AI_API_KEY");
required(env, "AI_CHAT_MODEL");
required(env, "KOKORO_BASE_URL");
required(env, "KOKORO_API_KEY");

const tables = await teableRequest(env, `/api/base/${required(env, "TEABLE_BASE_ID")}/table`);
const byId = new Map(tables.map((table) => [table.id, table.name]));

for (const [envName, expectedName] of tableDefinitions) {
  const tableId = required(env, envName);
  if (byId.get(tableId) !== expectedName) throw new Error(`${envName} does not map to ${expectedName} in the QA base.`);
}

console.log(`QA environment validated: ${tableDefinitions.length} tables mapped in the isolated base.`);
