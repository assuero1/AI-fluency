import { handleApiError, jsonOk } from "@/lib/api/responses";
import { judgeNewWordsAttempt } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return jsonOk({ ok: true, attempt: await judgeNewWordsAttempt(body) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
