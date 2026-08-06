import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getTeacherMessages, sendTeacherMessage } from "@/lib/learning/conversation-teacher";

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const messages = await getTeacherMessages(conversationId);
    return jsonOk({ ok: true, messages });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as { text?: string; clientRequestId?: string };
    const result = await sendTeacherMessage(conversationId, body.text ?? "", body.clientRequestId);
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
