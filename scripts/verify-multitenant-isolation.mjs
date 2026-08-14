// Verifies multitenant isolation under RLS: user B must not read or update
// user A's rows. Creates two ephemeral auth users, runs the checks via
// PostgREST with each user's JWT, and always cleans up. Exits 1 on any leak.
// Usage: node scripts/verify-multitenant-isolation.mjs [--env .env.qa.local]
import { readEnv, required } from "./qa-env.mjs";

const envPath = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.qa.local";
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const anonKey = required(env, "SUPABASE_ANON_KEY");

const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

async function createAuthUser(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (!res.ok) throw new Error(`create user failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function signIn(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`sign in failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const authedHeaders = (token) => ({ apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

const stamp = Date.now();
const password = `qa-iso-${Math.random().toString(36).slice(2)}!${stamp}`;
const emailA = `iso-a-${stamp}@qa.local`;
const emailB = `iso-b-${stamp}@qa.local`;

let userA;
let userB;
let wordId;

try {
  userA = await createAuthUser(emailA, password);
  userB = await createAuthUser(emailB, password);
  const tokenA = await signIn(emailA, password);
  const tokenB = await signIn(emailB, password);

  // Public users record of A (created by the handle_new_user trigger).
  const meRes = await fetch(`${supabaseUrl}/rest/v1/users?select=id`, { headers: authedHeaders(tokenA) });
  if (!meRes.ok) throw new Error(`lookup of A's users row failed: ${meRes.status} ${await meRes.text()}`);
  const [{ id: userRecordA }] = await meRes.json();
  if (!userRecordA) throw new Error("no public users row for A (trigger handle_new_user missing?)");

  // A inserts a word (words columns per supabase/migrations/0001_initial_schema.sql;
  // only id is required and it has a default; canonical_key is unique).
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/words`, {
    method: "POST", headers: { ...authedHeaders(tokenA), Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userRecordA, canonical_key: `iso-${stamp}`, lemma: "isolationtest" })
  });
  if (!insertRes.ok) throw new Error(`insert as A failed: ${insertRes.status} ${await insertRes.text()}`);
  [{ id: wordId }] = await insertRes.json();

  // (a) B must not read A's word.
  const readB = await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}&select=id`, { headers: authedHeaders(tokenB) });
  if (!readB.ok) throw new Error(`read as B failed: ${readB.status} ${await readB.text()}`);
  const leaked = await readB.json();
  if (leaked.length !== 0) throw new Error("ISOLATION FAIL: usuário B leu word de A");

  // (b) B must not update A's word (RLS filters the row out, so 0 rows returned).
  const writeB = await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}`, {
    method: "PATCH", headers: { ...authedHeaders(tokenB), Prefer: "return=representation" },
    body: JSON.stringify({ lemma: "hacked" })
  });
  if (!writeB.ok) throw new Error(`write as B failed: ${writeB.status} ${await writeB.text()}`);
  const written = await writeB.json();
  if (Array.isArray(written) && written.length !== 0) throw new Error("ISOLATION FAIL: usuário B alterou word de A");

  console.log(JSON.stringify({ ok: true }));
} finally {
  // Cleanup: A's word first (service role), then both auth users; the
  // users.auth_user_id on delete cascade removes the public users rows.
  if (wordId) {
    await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}`, { method: "DELETE", headers: adminHeaders });
  }
  for (const id of [userA, userB]) {
    if (id) await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders });
  }
}
