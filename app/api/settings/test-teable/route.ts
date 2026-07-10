import { getTeableClient } from "@/lib/teable/client";
import { getTeableStatus } from "@/lib/teable/config";
import { handleApiError, jsonOk } from "@/lib/api/responses";

export async function POST() {
  try {
    const result = await getTeableClient().healthcheck();
    return jsonOk({
      ok: true,
      result,
      status: getTeableStatus()
    });
  } catch (error) {
    return handleApiError(error);
  }
}
