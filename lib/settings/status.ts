import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getTTSStatus } from "@/lib/tts/factory";
import { getSupabaseStatus } from "@/lib/supabase/config";

export async function getConnectionStatus() {
  return {
    ai: await getAiStatus(),
    supabase: getSupabaseStatus(),
    kokoro: getKokoroStatus(),
    tts: getTTSStatus()
  };
}

export function isDataBackendReady(status: Awaited<ReturnType<typeof getConnectionStatus>>) {
  return status.supabase.configured;
}
