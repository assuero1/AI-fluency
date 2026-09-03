import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getDailyQueueSummary } from "@/lib/learning/flashcards";

// Leve: alimenta o badge da bottom nav (Palavras).
export async function GET() {
  try {
    const dailyQueue = await getDailyQueueSummary();
    return jsonOk({ ok: true, dueCount: dailyQueue?.dueCount ?? 0, newCount: dailyQueue?.newCount ?? 0 });
  } catch (error) { return handleApiError(error); }
}
