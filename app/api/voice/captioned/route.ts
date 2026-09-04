import { handleApiError, jsonOk } from "@/lib/api/responses";
import { prepareCaptionedSpeech } from "@/lib/kokoro/cache";
import { getActiveTTSProvider } from "@/lib/tts/factory";
import { normalizeSpeechLanguage } from "@/lib/kokoro/voices";

const supportedLanguages = new Set(["en", "es", "fr", "it", "pt", "ja", "zh", "hi"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; languageCode?: string; format?: string; voice?: string };
    const provider = getActiveTTSProvider();
    const requestedLanguage = normalizeSpeechLanguage(body.languageCode);
    const speechLanguage = supportedLanguages.has(requestedLanguage) ? requestedLanguage : "en";
    const voice = body.voice || provider.resolveVoice(speechLanguage);
    const format = body.format || provider.getOutputFormat();
    const speed = provider.getSpeed();

    const result = await prepareCaptionedSpeech(body.text ?? "", {
      voice,
      format,
      speed,
      languageCode: speechLanguage
    });

    return jsonOk({ ok: true, languageCode: speechLanguage, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
