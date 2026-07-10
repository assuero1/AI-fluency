import { handleApiError, jsonOk } from "@/lib/api/responses";
import { startCalendarPractice } from "@/lib/learning/feedback";

export async function POST(_request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await context.params;
    const result = await startCalendarPractice(date);
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
