import { handleApiError, jsonOk } from "@/lib/api/responses";
import { testKokoroConnection } from "@/lib/kokoro/client";

export async function POST() {
  try {
    const result = await testKokoroConnection();
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
