import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getConversationSummary } from "@/lib/learning/feedback";

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const result = await getConversationSummary(conversationId);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
