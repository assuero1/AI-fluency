import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getTeableStatus } from "@/lib/teable/config";

export function getConnectionStatus() {
  return {
    ai: getAiStatus(),
    teable: getTeableStatus(),
    kokoro: getKokoroStatus()
  };
}
