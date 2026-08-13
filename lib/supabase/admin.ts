import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

// Service role client: bypassa RLS. Uso restrito a scripts/ e routes admin
// (vinculação inicial, fixtures de QA). Nunca importar de páginas/actions do app.
export function createServiceRoleClient() {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new TeableConfigError("SUPABASE_URL is not configured.");
  if (!serviceRoleKey) throw new TeableConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
