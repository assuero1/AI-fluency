import { handleApiError, jsonOk } from "@/lib/api/responses";
import { LearningStateError } from "@/lib/learning/access";
import { runConversationQuickAction } from "@/lib/learning/conversations";
import { normalizeConversationQuickAction } from "@/lib/learning/quick-actions";

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = normalizeConversationQuickAction(body.action);
    if (!action) throw new LearningStateError("Ação rápida inválida.", 422);
    return jsonOk({ ok: true, ...(await runConversationQuickAction(conversationId, action)) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
