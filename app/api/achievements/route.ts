import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getAchievementsSummary } from "@/lib/learning/achievements";
import { getSessionUser } from "@/lib/learning/profile";

export async function GET() {
  try {
    const user = await getSessionUser();
    return jsonOk({ ok: true, achievements: await getAchievementsSummary(user.id) });
  } catch (error) { return handleApiError(error); }
}
