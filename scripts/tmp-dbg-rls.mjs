import { readEnv } from "./qa-env.mjs";
import { createClient } from "@supabase/supabase-js";
const env = readEnv(".env.qa.local");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await sb.rpc("");
console.log(error?.message ?? "");
