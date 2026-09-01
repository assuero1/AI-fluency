import { handleApiError, jsonOk } from "@/lib/api/responses";
import { warmCachedSpeech } from "@/lib/kokoro/cache";
import { createNewWordsPractice, getActiveNewWordsPractice } from "@/lib/learning/new-words";
import { after } from "next/server";

export async function GET() {
  try {
    const activeSession = await getActiveNewWordsPractice();
    return jsonOk({ ok: true, activeSession });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { count?: unknown };
    const result = await createNewWordsPractice(body);
    const { pendingWarmTexts, languageCode } = result as { pendingWarmTexts?: string[]; languageCode?: string };
    // As 2 primeiras frases já saíram quentes do create; o restante esquenta
    // depois da resposta (serverless mantém a execução via after()).
    if (pendingWarmTexts?.length) {
      after(() => warmCachedSpeech(pendingWarmTexts, languageCode));
    }
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
