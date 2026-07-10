import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getProgressData } from "@/lib/learning/progress";

export async function GET() {
  try {
    return jsonOk({ ok: true, progress: await getProgressData() });
  } catch (error) {
    return handleApiError(error);
  }
}
