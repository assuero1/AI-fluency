import { handleApiError, jsonOk } from "@/lib/api/responses";
import { startProgressFocusPractice } from "@/lib/learning/progress";

export async function POST() {
  try {
    const result = await startProgressFocusPractice();
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
