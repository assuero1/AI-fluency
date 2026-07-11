import { handleApiError, jsonOk } from "@/lib/api/responses";
import { completeFlashcardPractice } from "@/lib/learning/flashcards";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: unknown; clientCompletionId?: unknown; answers?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const clientCompletionId = typeof body.clientCompletionId === "string" ? body.clientCompletionId : "";
    const answers = Array.isArray(body.answers) ? body.answers : [];
    return jsonOk({ ok: true, ...(await completeFlashcardPractice(sessionId, clientCompletionId, answers)) });
  } catch (error) { return handleApiError(error); }
}
