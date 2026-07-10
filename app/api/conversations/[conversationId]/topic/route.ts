import { handleApiError, jsonOk } from "@/lib/api/responses";
import { changeConversationTopic } from "@/lib/learning/conversations";

export async function PATCH(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as { title?: string };
    const result = await changeConversationTopic(conversationId, body.title ?? "");
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
