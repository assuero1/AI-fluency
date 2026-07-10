import { handleApiError, jsonOk } from "@/lib/api/responses";
import { deleteLearningHistory } from "@/lib/learning/account";

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await deleteLearningHistory({
      confirmationToken: typeof body.confirmationToken === "string" ? body.confirmationToken : undefined,
      phrase: typeof body.phrase === "string" ? body.phrase : undefined
    });
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
