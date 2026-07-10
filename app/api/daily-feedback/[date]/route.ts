import { handleApiError, jsonError, jsonOk } from "@/lib/api/responses";
import { getDailyFeedback } from "@/lib/learning/feedback";

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await context.params;
    const detail = await getDailyFeedback(date);
    if (!detail) return jsonError("Data inválida.", 404);
    return jsonOk({ ok: true, ...detail });
  } catch (error) {
    return handleApiError(error);
  }
}
