import { handleApiError, jsonOk } from "@/lib/api/responses";
import { after } from "next/server";
import { warmCaptionedMessage } from "@/lib/kokoro/cache";
import { flushConversationEventWrites, sendConversationMessage } from "@/lib/learning/conversations";

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as { text?: string; clientRequestId?: string };
    const result = await sendConversationMessage(conversationId, body.text ?? "", body.clientRequestId);
    after(() => flushConversationEventWrites());
    // Aquece a síntese do áudio da resposta ANTES de responder ao cliente:
    // quando o balão da IA renderizar no chat, o cache já estará 100% pronto,
    // eliminando a latência no primeiro clique de play.
    const assistant = result.assistantMessage?.fields;
    if (assistant?.text) {
      await warmCaptionedMessage(assistant.text, assistant.language_detected).catch(() => undefined);
    }
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
