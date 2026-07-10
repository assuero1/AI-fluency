import { getEnv, maskSecret } from "@/lib/env";
import { DEFAULT_KOKORO_VOICES } from "./voices";

export function getKokoroConfig() {
  const defaultVoice = getEnv("KOKORO_DEFAULT_VOICE") ?? DEFAULT_KOKORO_VOICES.en;
  const outputFormat = (getEnv("KOKORO_OUTPUT_FORMAT") ?? "mp3").toLowerCase();
  const voicesByLanguage = {
    en: getEnv("KOKORO_VOICE_EN") ?? defaultVoice,
    es: getEnv("KOKORO_VOICE_ES") ?? DEFAULT_KOKORO_VOICES.es,
    fr: getEnv("KOKORO_VOICE_FR") ?? DEFAULT_KOKORO_VOICES.fr,
    it: getEnv("KOKORO_VOICE_IT") ?? DEFAULT_KOKORO_VOICES.it,
    pt: getEnv("KOKORO_VOICE_PT") ?? DEFAULT_KOKORO_VOICES.pt
  };
  return {
    baseUrl: getEnv("KOKORO_BASE_URL"),
    apiKey: getEnv("KOKORO_API_KEY"),
    defaultVoice,
    voicesByLanguage,
    outputFormat,
    speed: clampNumber(getEnv("KOKORO_SPEED"), 1.08, 0.25, 4),
    allowedVoices: parseList(getEnv("KOKORO_ALLOWED_VOICES"), Object.values(voicesByLanguage)),
    allowedFormats: parseList(getEnv("KOKORO_ALLOWED_FORMATS"), [outputFormat]).map((value) => value.toLowerCase()),
    cacheDir: getEnv("AUDIO_CACHE_DIR") ?? ".audio-cache",
    cacheMaxMb: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_MB"), 200),
    cacheMaxAgeDays: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_AGE_DAYS"), 30)
  };
}

export function getKokoroStatus() {
  const config = getKokoroConfig();
  return {
    configured: Boolean(config.baseUrl && config.apiKey),
    baseUrlConfigured: Boolean(config.baseUrl),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    defaultVoice: config.defaultVoice,
    voicesByLanguage: config.voicesByLanguage,
    outputFormat: config.outputFormat,
    audioCacheEnabled: Boolean(config.cacheDir)
  };
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function parseList(value: string | undefined, fallback: string[]) {
  const parsed = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return [...new Set(parsed.length ? parsed : fallback)];
}
