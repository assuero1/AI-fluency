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

// Aplica TODAS as migrations em ordem por padrão — aplicar só a 0001 deixava o
// schema sem RLS (as policies vivem em 0003+). --file mantém o escape hatch
// para rodar um arquivo específico.
const migrationsDir = path.resolve("supabase/migrations");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const requestedFile = option("--file");
const sqlFiles = requestedFile
  ? [path.resolve(requestedFile)]
  : migrationFiles.map((file) => path.join(migrationsDir, file));

if (!checkOnly && !requestedFile) {
  console.log(`Aplicando ${sqlFiles.length} migrations: ${migrationFiles.join(", ")}`);
}

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

// Tabelas sem RLS ativa são o pior cenário (anon key lê/escreve tudo), e o
// --check antigo só validava existência de tabela. Exige RLS on e o número de
// policies esperado por tabela (users: select/update; demais: 4 operações).

if (checkOnly) {
  const missing = await checkTables();
  const rlsIssues = await checkRlsViaServiceRole();
  const ok = missing.length === 0 && rlsIssues.length === 0;
  console.log(JSON.stringify({ ok, missing, rlsIssues }, null, 2));
  process.exit(ok ? 0 : 1);
}

const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.log([
    "SUPABASE_ACCESS_TOKEN não configurado — aplicação manual:",
    `1. Abra o SQL Editor do projeto: ${supabaseUrl.replace("https://", "https://supabase.com/dashboard/project/").replace(".supabase.co", "")}/sql/new`,
    `2. Cole e execute, em ordem: ${migrationFiles.join(", ")}`,
    "3. Execute e depois rode: node scripts/apply-supabase-schema.mjs --check"
  ].join("\n"));
  process.exit(2);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
for (const sqlFile of sqlFiles) {
  const sql = fs.readFileSync(sqlFile, "utf8");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql })
  });
  if (!response.ok) {
    throw new Error(`Management API failed for ${path.basename(sqlFile)}: ${response.status} ${await response.text()}`);
  }
  console.log(`ok: ${path.basename(sqlFile)}`);
}

const missing = await checkTables();
const rlsIssues = await checkRlsViaServiceRole();
const ok = missing.length === 0 && rlsIssues.length === 0;
console.log(JSON.stringify({ ok, applied: sqlFiles.map((file) => path.basename(file)), missing, rlsIssues }, null, 2));
process.exit(ok ? 0 : 1);

/**
 * Consulta pg_class/pg_policies via PostgREST não é possível (o catálogo não é
 * exposto); usa o Management API quando há token, ou o endpoint SQL do
 * PostgREST não existe — por isso a checagem roda pelo Management API e, sem
 * token, é pulada com aviso.
 */
async function checkRlsViaServiceRole() {
  const accessToken = env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    console.log("Aviso: sem SUPABASE_ACCESS_TOKEN, --check não valida RLS (apenas tabelas).");
    return [];
  }
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const tableList = tablesJson.tables.map(({ tableName }) => tableName);
  const query = `
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in (${tableList.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ")});
  `;
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!response.ok) {
    throw new Error(`RLS check failed: ${response.status} ${await response.text()}`);
  }
  const rows = await response.json();
  const issues = [];
  for (const { tableName } of tablesJson.tables) {
    const row = rows.find((candidate) => candidate.table_name === tableName);
    if (!row) {
      issues.push({ tableName, issue: "tabela ausente no catálogo" });
      continue;
    }
    if (!row.rls_enabled) {
      issues.push({ tableName, issue: "RLS desativado" });
      continue;
    }
    const expectedPolicies = tableName === "users" ? 2 : 4;
    if (Number(row.policy_count) < expectedPolicies) {
      issues.push({ tableName, issue: `policies insuficientes (${row.policy_count} < ${expectedPolicies})` });
    }
  }
  return issues;
}
