import fs from "node:fs";
import path from "node:path";
import { readEnv, required } from "./qa-env.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const checkOnly = process.argv.includes("--check");
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");

const sqlPath = path.resolve("supabase/migrations/0001_initial_schema.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function checkTables() {
  const missing = [];
  for (const { tableName } of tablesJson.tables) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!response.ok) missing.push({ tableName, status: response.status });
  }
  return missing;
}

if (checkOnly) {
  const missing = await checkTables();
  console.log(JSON.stringify({ ok: missing.length === 0, missing }, null, 2));
  process.exit(missing.length === 0 ? 0 : 1);
}

const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.log([
    "SUPABASE_ACCESS_TOKEN não configurado — aplicação manual:",
    `1. Abra o SQL Editor do projeto: ${supabaseUrl.replace("https://", "https://supabase.com/dashboard/project/").replace(".supabase.co", "")}/sql/new`,
    `2. Cole o conteúdo de: ${sqlPath}`,
    "3. Execute e depois rode: node scripts/apply-supabase-schema.mjs --check"
  ].join("\n"));
  process.exit(2);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql })
});
if (!response.ok) {
  throw new Error(`Management API failed: ${response.status} ${await response.text()}`);
}

const missing = await checkTables();
console.log(JSON.stringify({ ok: missing.length === 0, applied: true, missing }, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
