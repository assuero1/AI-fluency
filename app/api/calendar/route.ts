import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getCalendarData } from "@/lib/learning/feedback";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const calendar = await getCalendarData(searchParams.get("month") ?? undefined);
    return jsonOk({ ok: true, calendar });
  } catch (error) {
    return handleApiError(error);
  }
}
