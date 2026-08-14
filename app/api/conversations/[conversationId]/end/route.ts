import { handleApiError, jsonOk } from "@/lib/api/responses";
import { endConversation } from "@/lib/learning/feedback";

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json().catch(() => null)) as { pausedMs?: unknown } | null;
    const result = await endConversation(conversationId, {
      pausedMs: typeof body?.pausedMs === "number" ? body.pausedMs : 0
    });
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
