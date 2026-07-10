import { handleApiError, jsonOk } from "@/lib/api/responses";
import { translateToPortuguese } from "@/lib/learning/translation";

const supportedSourceLanguages = new Set(["en", "es", "fr", "it", "pt"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; sourceLanguage?: string };
    const sourceLanguage = body.sourceLanguage?.trim().toLowerCase().split(/[-_]/)[0] ?? "auto";
    const result = await translateToPortuguese(
      body.text ?? "",
      supportedSourceLanguages.has(sourceLanguage) ? sourceLanguage : "auto"
    );
    return jsonOk({ ok: true, targetLanguage: "pt-BR", ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
