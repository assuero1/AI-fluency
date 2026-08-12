import { handleApiError, jsonError, jsonOk } from "@/lib/api/responses";
import { addManualWordSense } from "@/lib/learning/words";

export async function POST(request: Request, { params }: { params: Promise<{ wordId: string }> }): Promise<Response> {
  try {
    const { wordId } = await params;
    const body = (await request.json().catch(() => null)) as { translation?: unknown; partOfSpeech?: unknown; exampleSentence?: unknown } | null;
    const translation = typeof body?.translation === "string" ? body.translation.trim() : "";
    if (!translation) return jsonError("Informe a tradução do significado.", 422);
    const sense = await addManualWordSense(wordId, {
      translation,
      partOfSpeech: typeof body?.partOfSpeech === "string" ? body.partOfSpeech : undefined,
      exampleSentence: typeof body?.exampleSentence === "string" ? body.exampleSentence : undefined
    });
    return jsonOk({ ok: true, sense }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
