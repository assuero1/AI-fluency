import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getTeableStatus } from "@/lib/teable/config";

export async function getConnectionStatus() {
  return {
    ai: await getAiStatus(),
    teable: getTeableStatus(),
    kokoro: getKokoroStatus()
  };
}
