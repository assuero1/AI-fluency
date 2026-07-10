import { handleApiError, jsonOk } from "@/lib/api/responses";
import { endConversation } from "@/lib/learning/feedback";

export async function POST(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const result = await endConversation(conversationId);
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
