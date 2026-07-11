import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createFlashcardRetraining } from "@/lib/learning/flashcards";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceSessionId?: string; mode?: unknown };
    return jsonOk({ ok: true, ...(await createFlashcardRetraining(body.sourceSessionId ?? "", body.mode)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
