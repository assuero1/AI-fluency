import { getTeableClient } from "@/lib/supabase/client";
import { getSupabaseStatus } from "@/lib/supabase/config";
import { handleApiError, jsonOk } from "@/lib/api/responses";

export async function POST() {
  try {
    const result = await getTeableClient().healthcheck();
    return jsonOk({
      ok: true,
      result,
      status: getSupabaseStatus()
    });
  } catch (error) {
    return handleApiError(error);
  }
}
