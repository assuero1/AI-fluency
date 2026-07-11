import { handleApiError, jsonOk } from "@/lib/api/responses";
import { abandonConversation } from "@/lib/learning/conversations";

export async function POST(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return jsonOk({ ok: true, ...(await abandonConversation(conversationId)) });
  } catch (error) {
    return handleApiError(error);
  }
}
