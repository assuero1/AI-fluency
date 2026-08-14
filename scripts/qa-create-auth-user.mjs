// Creates the QA auth user (already email-confirmed; QA has no mailbox).
// Usage: node scripts/qa-create-auth-user.mjs [--env .env.qa.local]
import { readEnv, required } from "./qa-env.mjs";

const envPath = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.qa.local";
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const email = required(env, "QA_USER_EMAIL");
const password = required(env, "QA_USER_PASSWORD");

const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "QA" } })
});
if (!response.ok && response.status !== 422) throw new Error(`Create failed: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({ ok: true, email }));
