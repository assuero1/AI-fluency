import { TTSConfigError } from "@/lib/tts/types";
import { getEnv, maskSecret } from "@/lib/env";

export function getDeepInfraKokoroConfig() {
  const defaultVoice = getEnv("DEEPINFRA_KOKORO_DEFAULT_VOICE") ?? "af_heart";

  return {
    apiKey: getEnv("DEEPINFRA_API_KEY") || getEnv("DEEPINFRA_TOKEN"),
    baseUrl: getEnv("DEEPINFRA_BASE_URL") ?? "https://api.deepinfra.com",
    model: getEnv("DEEPINFRA_KOKORO_MODEL") ?? "hexgrad/Kokoro-82M",
    defaultVoice,
    voicesByLanguage: {
      en: getEnv("DEEPINFRA_KOKORO_VOICE_EN") ?? defaultVoice,
      es: getEnv("DEEPINFRA_KOKORO_VOICE_ES") ?? defaultVoice,
      fr: getEnv("DEEPINFRA_KOKORO_VOICE_FR") ?? defaultVoice,
      it: getEnv("DEEPINFRA_KOKORO_VOICE_IT") ?? defaultVoice,
      pt: getEnv("DEEPINFRA_KOKORO_VOICE_PT") ?? defaultVoice,
      ja: getEnv("DEEPINFRA_KOKORO_VOICE_JA") ?? defaultVoice,
      zh: getEnv("DEEPINFRA_KOKORO_VOICE_ZH") ?? defaultVoice,
      hi: getEnv("DEEPINFRA_KOKORO_VOICE_HI") ?? defaultVoice
    },
    outputFormat: (getEnv("DEEPINFRA_KOKORO_OUTPUT_FORMAT") ?? "opus").toLowerCase(),
    speed: clampNumber(getEnv("DEEPINFRA_KOKORO_SPEED"), 1.08, 0.25, 4),
    serviceTier: configuredChoice("DEEPINFRA_KOKORO_SERVICE_TIER", "default", ["default", "priority", "flex"]),
    requestTimeoutMs: configuredNumber("DEEPINFRA_KOKORO_TIMEOUT_MS", 35000, 1000, 120000, true),
    cacheDir: getEnv("AUDIO_CACHE_DIR") ?? ".audio-cache",
    cacheMaxMb: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_MB"), 200),
    cacheMaxAgeDays: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_AGE_DAYS"), 30)
  };
}

export function getDeepInfraKokoroStatus() {
  const config = getDeepInfraKokoroConfig();
  return {
    configured: Boolean(config.apiKey),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
    defaultVoice: config.defaultVoice,
    voicesByLanguage: config.voicesByLanguage,
    outputFormat: config.outputFormat,
    speed: config.speed,
    serviceTier: config.serviceTier,
    requestTimeoutMs: config.requestTimeoutMs,
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

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number, integer = false) {
  const raw = getEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    throw new TTSConfigError(`${name} must be ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function configuredChoice(name: string, fallback: string, allowed: string[]) {
  const value = getEnv(name) ?? fallback;
  if (!allowed.includes(value)) throw new TTSConfigError(`${name} must be one of: ${allowed.join(", ")} .`);
  return value;
}
