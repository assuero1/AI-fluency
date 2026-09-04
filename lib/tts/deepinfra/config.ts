import { getEnv, getFirstEnv, maskSecret } from "@/lib/env";

export function getDeepInfraConfig() {
  const defaultVoice = getEnv("DEEPINFRA_CHATTERBOX_DEFAULT_VOICE") ?? "";
  const outputFormat = (getEnv("DEEPINFRA_CHATTERBOX_OUTPUT_FORMAT") ?? "mp3").toLowerCase();
  const voicesByLanguage: Record<string, string> = {
    en: getEnv("DEEPINFRA_CHATTERBOX_VOICE_EN") ?? defaultVoice,
    es: getEnv("DEEPINFRA_CHATTERBOX_VOICE_ES") ?? defaultVoice,
    fr: getEnv("DEEPINFRA_CHATTERBOX_VOICE_FR") ?? defaultVoice,
    it: getEnv("DEEPINFRA_CHATTERBOX_VOICE_IT") ?? defaultVoice,
    pt: getEnv("DEEPINFRA_CHATTERBOX_VOICE_PT") ?? defaultVoice,
    ja: getEnv("DEEPINFRA_CHATTERBOX_VOICE_JA") ?? defaultVoice,
    zh: getEnv("DEEPINFRA_CHATTERBOX_VOICE_ZH") ?? defaultVoice,
    hi: getEnv("DEEPINFRA_CHATTERBOX_VOICE_HI") ?? defaultVoice
  };

  return {
    apiKey: getFirstEnv(["DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"]),
    baseUrl: getEnv("DEEPINFRA_BASE_URL") ?? "https://api.deepinfra.com",
    model: getEnv("DEEPINFRA_CHATTERBOX_MODEL") ?? "ResembleAI/chatterbox-multilingual",
    defaultVoice,
    voicesByLanguage,
    outputFormat,
    speed: clampNumber(getEnv("DEEPINFRA_CHATTERBOX_SPEED"), 1.0, 0.25, 4),
    exaggeration: parseOptionalNumber(getEnv("DEEPINFRA_CHATTERBOX_EXAGGERATION")),
    cfgWeight: parseOptionalNumber(getEnv("DEEPINFRA_CHATTERBOX_CFG_WEIGHT")),
    cacheDir: getEnv("AUDIO_CACHE_DIR") ?? ".audio-cache",
    cacheMaxMb: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_MB"), 200),
    cacheMaxAgeDays: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_AGE_DAYS"), 30)
  };
}

export function getDeepInfraStatus() {
  const config = getDeepInfraConfig();
  return {
    configured: Boolean(config.apiKey),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
    defaultVoice: config.defaultVoice || "default",
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

function parseOptionalNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
