import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getConversationVocabularyGroups } from "@/lib/learning/vocabulary-selection";

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return jsonOk({ ok: true, groups: await getConversationVocabularyGroups(conversationId) });
  } catch (error) {
    return handleApiError(error);
  }
}
