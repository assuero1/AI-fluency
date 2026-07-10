import { handleApiError, jsonOk } from "@/lib/api/responses";
import { startConversation } from "@/lib/learning/conversations";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await startConversation({
      topicId: typeof body.topicId === "string" ? body.topicId : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined
    });

    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
