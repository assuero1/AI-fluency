import { handleApiError, jsonOk } from "@/lib/api/responses";
import { prepareCachedSpeech } from "@/lib/kokoro/cache";
import { getKokoroConfig } from "@/lib/kokoro/config";
import { normalizeSpeechLanguage, selectKokoroVoice } from "@/lib/kokoro/voices";

const supportedLanguages = new Set(["en", "es", "fr", "it", "pt"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; languageCode?: string; format?: string };
    const config = getKokoroConfig();
    const requestedLanguage = normalizeSpeechLanguage(body.languageCode);
    const speechLanguage = supportedLanguages.has(requestedLanguage) ? requestedLanguage : "en";
    const voice = selectKokoroVoice(speechLanguage, config.voicesByLanguage, config.defaultVoice);
    const result = await prepareCachedSpeech(body.text ?? "", {
      voice,
      format: body.format,
      speed: config.speed
    });

    return jsonOk({ ok: true, languageCode: speechLanguage, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
