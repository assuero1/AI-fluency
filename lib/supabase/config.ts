import { getEnv, maskSecret } from "@/lib/env";

export type DataBackend = "teable" | "supabase";

export type SupabaseConfig = {
  url?: string;
  serviceRoleKey?: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: getEnv("SUPABASE_URL"),
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

export function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

export function resolveDataBackend(): DataBackend {
  const explicit = (process.env.DATA_BACKEND ?? "").trim().toLowerCase();
  if (explicit === "teable" || explicit === "supabase") return explicit;
  return isSupabaseConfigured() ? "supabase" : "teable";
}

export function getSupabaseStatus() {
  const config = getSupabaseConfig();
  return {
    configured: isSupabaseConfigured(),
    urlConfigured: Boolean(config.url),
    serviceRoleKeyConfigured: Boolean(config.serviceRoleKey),
    serviceRoleKeyMasked: maskSecret(config.serviceRoleKey),
    backend: resolveDataBackend()
  };
}
