import { handleApiError, jsonOk } from "@/lib/api/responses";
import { testAiConnection } from "@/lib/ai/client";

export async function POST() {
  try {
    const result = await testAiConnection();
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
