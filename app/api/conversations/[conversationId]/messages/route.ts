import { handleApiError, jsonOk } from "@/lib/api/responses";
import { sendConversationMessage } from "@/lib/learning/conversations";

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as { text?: string; clientRequestId?: string };
    const result = await sendConversationMessage(conversationId, body.text ?? "", body.clientRequestId);
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
