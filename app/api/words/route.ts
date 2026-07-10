import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getWordsData, normalizeWordFilter } from "@/lib/learning/words";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = normalizeWordFilter(searchParams.get("filter") ?? undefined);
    const data = await getWordsData(filter, searchParams.get("q") ?? "");
    return jsonOk({ ok: true, ...data });
  } catch (error) {
    return handleApiError(error);
  }
}
