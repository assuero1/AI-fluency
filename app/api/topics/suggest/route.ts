import { handleApiError, jsonOk } from "@/lib/api/responses";
import { suggestTopic } from "@/lib/learning/topics";

export async function POST() {
  try {
    const result = await suggestTopic();
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
