import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

const REQUEST_TIMEOUT_MS = 10_000;

function withTimeoutSignal(signal?: AbortSignal | null) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

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
    // postgrest-js >= 2.112 retenta GET/HEAD/OPTIONS internamente por padrão
    // (até 3x, incluindo HTTP 503/520). Desabilitamos: o adapter já faz seu
    // próprio retry único em falhas transitórias, espelhando o TeableClient.
    db: { retry: false },
    global: {
      fetch: (fetchUrl, init) => fetch(fetchUrl, { ...init, signal: withTimeoutSignal(init?.signal ?? null) })
    },
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
