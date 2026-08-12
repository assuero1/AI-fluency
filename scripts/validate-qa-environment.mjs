import { assertQaEnvironment, readEnv, required } from "./qa-env.mjs";
import { dbList, getSupabaseAdmin } from "./lib/supabase-admin.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");
const env = readEnv(envPath);
assertQaEnvironment(env);
required(env, "SUPABASE_URL");
required(env, "SUPABASE_SERVICE_ROLE_KEY");
required(env, "AI_BASE_URL");
required(env, "AI_API_KEY");
required(env, "AI_CHAT_MODEL");
required(env, "KOKORO_BASE_URL");
required(env, "KOKORO_API_KEY");
if (!getSupabaseAdmin(env)) throw new Error("Supabase admin client is not configured.");

// Every table in lib/supabase/tables.json must be reachable in the shared
// Supabase project (QA fixtures live alongside production data, marked by a
// QA user).
for (const table of tablesJson.tables) {
  await dbList(env, table.key, { limit: 1 });
}

console.log(`QA environment validated: ${tablesJson.tables.length} tables reachable in Supabase.`);
