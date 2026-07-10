import { jsonOk } from "@/lib/api/responses";
import { getConnectionStatus } from "@/lib/settings/status";

// This endpoint is also useful for safely checking the runtime environment.
// Never cache a response that reflects server configuration.
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk({
    ok: true,
    connections: getConnectionStatus()
  });
}
