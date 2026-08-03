import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createFlashcardPractice, getActiveFlashcardPractice, getDailyQueueSummary } from "@/lib/learning/flashcards";

export async function GET() {
  try {
    const [activeSession, dailyQueue] = await Promise.all([getActiveFlashcardPractice(), getDailyQueueSummary()]);
    return jsonOk({ ok: true, activeSession, dailyQueue });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { criterion?: unknown; count?: unknown; queueKind?: unknown };
    return jsonOk({ ok: true, ...(await createFlashcardPractice(body)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
