import { getTeableClient } from "@/lib/teable/client";
import { getTeableStatus } from "@/lib/teable/config";
import { handleApiError, jsonOk } from "@/lib/api/responses";

export async function GET() {
  const status = getTeableStatus();

  if (!status.configured) {
    return jsonOk({
      ok: false,
      status,
      message: "Teable base URL or API key is not configured."
    }, { status: 503 });
  }

  try {
    await getTeableClient().healthcheck();
    return jsonOk({
      ok: true,
      status,
      message: "Teable is reachable."
    });
  } catch (error) {
    return handleApiError(error);
  }
}
