import { handleApiError, jsonOk } from "@/lib/api/responses";
import { testTTSConnection } from "@/lib/tts/factory";

export async function POST() {
  try {
    const result = await testTTSConnection();
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
