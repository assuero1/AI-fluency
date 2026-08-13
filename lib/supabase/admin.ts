import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

const REQUEST_TIMEOUT_MS = 10_000;

function withTimeoutSignal(signal?: AbortSignal | null) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Service role client: bypassa RLS. Uso restrito a scripts/ e routes admin
// (vinculação inicial, fixtures de QA). Nunca importar de páginas/actions do app.
export function createServiceRoleClient() {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new TeableConfigError("SUPABASE_URL is not configured.");
  if (!serviceRoleKey) throw new TeableConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Mesmas garantias do request client: sem retries internos do postgrest-js
    // (o adapter tem seu próprio retry único) e teto de 10s por request.
    db: { retry: false },
    global: {
      fetch: (fetchUrl, init) => fetch(fetchUrl, { ...init, signal: withTimeoutSignal(init?.signal ?? null) })
    }
  });
}
