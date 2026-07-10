import { handleApiError, jsonOk } from "@/lib/api/responses";
import { assertPracticeReady } from "@/lib/learning/access";
import { createTopic } from "@/lib/learning/topics";

export async function GET() {
  try {
    const { client, user, profile } = await assertPracticeReady();
    const records = (await client.listRecords<{ user_id?: string; language_profile_id?: string }>("topics", 100)).filter(
      (record) => record.fields.user_id === user.id && record.fields.language_profile_id === profile.id
    );
    return jsonOk({ ok: true, records });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { topic } = await createTopic({
      title: String(body.title ?? "Conversa livre"),
      source: String(body.source ?? "user_custom"),
      reason: String(body.reason ?? ""),
      difficulty: String(body.difficulty ?? "B1"),
      relatedFeedbackId: String(body.related_feedback_id ?? ""),
      relatedWords: String(body.related_words ?? "")
    });
    return jsonOk({ ok: true, record: topic }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
