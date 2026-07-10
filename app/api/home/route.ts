import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getHomeData } from "@/lib/learning/home";

export async function GET() {
  try {
    const home = await getHomeData();
    return jsonOk({ ok: true, home });
  } catch (error) {
    return handleApiError(error);
  }
}
