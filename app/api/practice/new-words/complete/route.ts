import { handleApiError, jsonOk } from "@/lib/api/responses";
import { completeNewWordsPractice } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: unknown; clientCompletionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const clientCompletionId = typeof body.clientCompletionId === "string" ? body.clientCompletionId : "";
    return jsonOk({ ok: true, ...(await completeNewWordsPractice(sessionId, clientCompletionId)) });
  } catch (error) { return handleApiError(error); }
}
