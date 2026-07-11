import { handleApiError, jsonOk } from "@/lib/api/responses";
import { saveSelectedVocabulary } from "@/lib/learning/vocabulary-selection";

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    const body = await request.json() as { candidateIds?: unknown };
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds.filter((id): id is string => typeof id === "string") : [];
    return jsonOk({ ok: true, ...(await saveSelectedVocabulary(conversationId, candidateIds)) });
  } catch (error) {
    return handleApiError(error);
  }
}
