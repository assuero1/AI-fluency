import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createNewWordsPractice, getActiveNewWordsPractice } from "@/lib/learning/new-words";

export async function GET() {
  try {
    const activeSession = await getActiveNewWordsPractice();
    return jsonOk({ ok: true, activeSession });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { count?: unknown };
    return jsonOk({ ok: true, ...(await createNewWordsPractice(body)) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
