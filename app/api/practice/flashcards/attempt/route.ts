import { handleApiError, jsonOk } from "@/lib/api/responses";
import { persistFlashcardAttempt } from "@/lib/learning/flashcards";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return jsonOk({ ok: true, attempt: await persistFlashcardAttempt(body) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
