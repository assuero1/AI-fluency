import { handleApiError, jsonOk } from "@/lib/api/responses";
import { previewFlashcardAttemptIntervals } from "@/lib/learning/flashcards";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return jsonOk({ ok: true, ...(await previewFlashcardAttemptIntervals(body)) });
  } catch (error) { return handleApiError(error); }
}
