import { readEnv, required } from "./qa-env.mjs";

const env = readEnv(".env.local");
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const authEmail = required(env, "LINK_AUTH_EMAIL"); // email da conta criada no /login

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

// 1. Acha o auth user pelo email (Admin API)
const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers });
if (!listRes.ok) throw new Error(`Admin list failed: ${listRes.status} ${await listRes.text()}`);
const { users: authUsers } = await listRes.json();
const authUser = authUsers.find((u) => u.email?.toLowerCase() === authEmail.toLowerCase());
if (!authUser) throw new Error(`Nenhum auth user com email ${authEmail}. Crie a conta no /login primeiro.`);

// 2. Acha o registro users ainda não vinculado que tem dados (o usuário pessoal)
const usersRes = await fetch(`${supabaseUrl}/rest/v1/users?auth_user_id=is.null&select=id,Name`, { headers });
if (!usersRes.ok) throw new Error(`Users query failed: ${usersRes.status} ${await usersRes.text()}`);
const candidates = await usersRes.json();
if (candidates.length !== 1) {
  throw new Error(`Esperado exatamente 1 usuário sem vínculo, achei ${candidates.length}. Revise manualmente.`);
}

// 3. Vincula
const updateRes = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${candidates[0].id}`, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({ auth_user_id: authUser.id })
});
if (!updateRes.ok) throw new Error(`Link failed: ${updateRes.status} ${await updateRes.text()}`);

console.log(JSON.stringify({ ok: true, usersRecord: candidates[0].id, authUser: authUser.id, email: authUser.email }, null, 2));
