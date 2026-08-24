import { readEnv } from "./qa-env.mjs";
import { getSupabaseAdmin } from "./lib/supabase-admin.mjs";

const env = readEnv(".env.local");
const supabase = getSupabaseAdmin(env);
if (!supabase) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");

const { data, error } = await supabase
  .from("app_events")
  .select("event_name, payload, created_at")
  .in("event_name", ["voice_device_fallback", "voice_kokoro_failure"])
  .order("created_at", { ascending: false })
  .limit(100);
if (error) throw new Error(error.message);

console.log(`total amostras: ${data.length}`);
const reasons = new Map();
for (const row of data) {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const reason = `${row.event_name}: ${payload?.reason || "(sem motivo)"}`;
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}
console.log("\nMotivos:");
for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x  ${reason}`);
}
console.log("\nÚltimas 5 amostras:");
for (const row of data.slice(0, 5)) {
  const payload = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
  console.log(`  ${row.created_at}  ${row.event_name}  ${payload}`);
}
