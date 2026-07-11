import { handleApiError, jsonOk } from "@/lib/api/responses";
import { abandonFlashcardPractice } from "@/lib/learning/flashcards";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return jsonOk({ ok: true, ...(await abandonFlashcardPractice(sessionId)) });
  } catch (error) { return handleApiError(error); }
}
