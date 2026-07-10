import { handleApiError, jsonError, jsonOk } from "@/lib/api/responses";
import { getConversationWithTutorStart } from "@/lib/learning/conversations";

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const conversation = await getConversationWithTutorStart(conversationId);
    if (!conversation) return jsonError("Conversa não encontrada.", 404);
    return jsonOk({ ok: true, ...conversation });
  } catch (error) {
    return handleApiError(error);
  }
}
