import { handleApiError, jsonOk } from "@/lib/api/responses";
import { generateNewWordsDeck, getActiveNewWordsPractice, startNewWordsPractice } from "@/lib/learning/new-words";
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
    // Responde na hora com a sessão em "preparing": a geração por IA (15–40s)
    // não pode mais ficar na requisição — era o que estourava o timeout do proxy.
    const result = await startNewWordsPractice(body);
    // O deck é gerado depois da resposta (serverless mantém a execução via
    // after()); o app faz polling do GET até a sessão ficar ativa.
    after(() => generateNewWordsDeck(result.sessionId).catch(() => undefined));
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
