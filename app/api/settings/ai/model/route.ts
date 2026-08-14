import { jsonError, jsonOk } from "@/lib/api/responses";
import { getAiStatus } from "@/lib/ai/config";
import { saveModelOverride } from "@/lib/ai/model-settings";
import { TeableConfigError, TeableRequestError } from "@/lib/supabase/client";

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { chatModel?: unknown } | null;
  const chatModel = typeof body?.chatModel === "string" ? body.chatModel.trim() : "";
  if (!chatModel) {
    return jsonError("Informe um modelo válido.", 400);
  }

  try {
    await saveModelOverride(chatModel);
  } catch (error) {
    if (error instanceof TeableConfigError || error instanceof TeableRequestError) {
      return jsonError("Não foi possível salvar o modelo. Tente novamente.", 503);
    }
    throw error;
  }

  return jsonOk({ ok: true, status: await getAiStatus() });
}
