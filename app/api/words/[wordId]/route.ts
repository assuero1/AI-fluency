import { handleApiError, jsonError, jsonOk } from "@/lib/api/responses";
import { getWordDetail } from "@/lib/learning/words";

export async function GET(_request: Request, context: { params: Promise<{ wordId: string }> }) {
  try {
    const { wordId } = await context.params;
    const data = await getWordDetail(wordId);
    if (!data) return jsonError("Palavra não encontrada.", 404);
    return jsonOk({ ok: true, ...data });
  } catch (error) {
    return handleApiError(error);
  }
}
