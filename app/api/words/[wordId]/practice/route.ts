import { handleApiError, jsonOk } from "@/lib/api/responses";
import { startWordPractice } from "@/lib/learning/words";

export async function POST(_request: Request, context: { params: Promise<{ wordId: string }> }) {
  try {
    const { wordId } = await context.params;
    const result = await startWordPractice(wordId);
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
