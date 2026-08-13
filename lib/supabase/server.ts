import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

function requireConfig() {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  if (!url) throw new TeableConfigError("SUPABASE_URL is not configured.");
  if (!anonKey) throw new TeableConfigError("SUPABASE_ANON_KEY is not configured.");
  return { url, anonKey };
}

// Cached per server request (React cache) so repeated callers within one
// request share a single client; outside a request it is a passthrough.
export const getRequestSupabaseClient = cache(async function getRequestSupabaseClient() {
  const { url, anonKey } = requireConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (cookies are read-only there);
          // the middleware refreshes the session, so this is safe to ignore.
        }
      }
    }
  });
});
