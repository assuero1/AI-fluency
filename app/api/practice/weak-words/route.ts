import { handleApiError, jsonOk } from "@/lib/api/responses";
import { startWeakWordsPractice } from "@/lib/learning/words";

export async function POST() {
  try {
    const result = await startWeakWordsPractice();
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
