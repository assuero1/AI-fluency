import { handleApiError, jsonOk } from "@/lib/api/responses";
import { explainSelection } from "@/lib/learning/selection-explanation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { text?: string; language?: string; context?: string };
    return jsonOk({ ok: true, explanation: await explainSelection(body.text ?? "", body.language ?? "auto", body.context ?? "") });
  } catch (error) { return handleApiError(error); }
}
