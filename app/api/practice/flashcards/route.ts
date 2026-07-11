import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createFlashcardPractice, getActiveFlashcardPractice } from "@/lib/learning/flashcards";

export async function GET() {
  try {
    return jsonOk({ ok: true, activeSession: await getActiveFlashcardPractice() });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { criterion?: unknown; count?: unknown };
    return jsonOk({ ok: true, ...(await createFlashcardPractice(body)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
