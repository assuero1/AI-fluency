import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createDeletionConfirmation } from "@/lib/learning/account";

export async function POST() {
  try {
    return jsonOk({ ok: true, ...(await createDeletionConfirmation()) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
