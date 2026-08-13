import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getSupabaseStatus, resolveDataBackend } from "@/lib/supabase/config";
import { getTeableStatus } from "@/lib/teable/config";

export async function getConnectionStatus() {
  return {
    ai: await getAiStatus(),
    backend: resolveDataBackend(),
    teable: getTeableStatus(),
    supabase: getSupabaseStatus(),
    kokoro: getKokoroStatus()
  };
}

export function isDataBackendReady(status: Awaited<ReturnType<typeof getConnectionStatus>>) {
  if (status.backend === "supabase") return status.supabase.configured;
  return status.teable.configured && status.teable.mappedTableCount === status.teable.totalTableCount;
}
