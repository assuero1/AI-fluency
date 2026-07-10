import { jsonOk } from "@/lib/api/responses";
import { getConnectionStatus } from "@/lib/settings/status";

export async function GET() {
  return jsonOk({
    ok: true,
    connections: getConnectionStatus()
  });
}
