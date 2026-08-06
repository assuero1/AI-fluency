import { handleApiError, jsonOk } from "@/lib/api/responses";
import { undoFlashcardAttempt } from "@/lib/learning/flashcards";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return jsonOk({ ok: true, ...(await undoFlashcardAttempt(sessionId)) });
  } catch (error) { return handleApiError(error); }
}
