import { handleApiError, jsonOk } from "@/lib/api/responses";
import { abandonNewWordsPractice } from "@/lib/learning/new-words";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: unknown };
    return jsonOk({ ok: true, ...(await abandonNewWordsPractice(typeof body.sessionId === "string" ? body.sessionId : "")) });
  } catch (error) { return handleApiError(error); }
}
