import { TTSConfigError } from "@/lib/tts/types";
import { getEnv, getFirstEnv, maskSecret } from "@/lib/env";

export function getDeepInfraChatterboxConfig() {
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

  const rawTemp = getEnv("DEEPINFRA_CHATTERBOX_TEMPERATURE");
  const rawExagg = getEnv("DEEPINFRA_CHATTERBOX_EXAGGERATION");
  const rawCfg = getEnv("DEEPINFRA_CHATTERBOX_CFG_WEIGHT");

  return {
    apiKey: getFirstEnv(["DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"]),
    baseUrl: getEnv("DEEPINFRA_BASE_URL") ?? "https://api.deepinfra.com",
    model: getEnv("DEEPINFRA_CHATTERBOX_MODEL") ?? "ResembleAI/chatterbox-multilingual",
    defaultVoice,
    voicesByLanguage,
    outputFormat,
    speed: clampNumber(getEnv("DEEPINFRA_CHATTERBOX_SPEED"), 1.0, 0.25, 4),
    temperature: configuredNumber("DEEPINFRA_CHATTERBOX_TEMPERATURE", 0.65, 0, 2),
    exaggeration: configuredNumber("DEEPINFRA_CHATTERBOX_EXAGGERATION", 0.35, 0, 1),
    cfgWeight: configuredNumber("DEEPINFRA_CHATTERBOX_CFG_WEIGHT", 0.45, 0, 1),
    topP: configuredNumber("DEEPINFRA_CHATTERBOX_TOP_P", 0.95, 0, 1),
    minP: configuredNumber("DEEPINFRA_CHATTERBOX_MIN_P", 0, 0, 1),
    topK: configuredNumber("DEEPINFRA_CHATTERBOX_TOP_K", 1000, 0, 1000, true),
    repetitionPenalty: configuredNumber("DEEPINFRA_CHATTERBOX_REPETITION_PENALTY", 1.2, 0, 5),
    seed: getEnv("DEEPINFRA_CHATTERBOX_SEED") === undefined ? undefined : configuredNumber("DEEPINFRA_CHATTERBOX_SEED", 0, 0, 2147483647, true),
    serviceTier: configuredChoice("DEEPINFRA_CHATTERBOX_SERVICE_TIER", "default", ["default", "priority", "flex"]),
    failFast: configuredChoice("DEEPINFRA_CHATTERBOX_FAIL_FAST", "false", ["true", "false"]) === "true",
    requestTimeoutMs: configuredNumber("DEEPINFRA_CHATTERBOX_TIMEOUT_MS", 35000, 1000, 120000, true),
    shortTemperature: configuredNumber("DEEPINFRA_CHATTERBOX_SHORT_TEMPERATURE", rawTemp ? configuredNumber("DEEPINFRA_CHATTERBOX_TEMPERATURE", 0.65, 0, 2) : 0.5, 0, 2),
    shortExaggeration: configuredNumber("DEEPINFRA_CHATTERBOX_SHORT_EXAGGERATION", rawExagg ? configuredNumber("DEEPINFRA_CHATTERBOX_EXAGGERATION", 0.35, 0, 1) : 0.22, 0, 1),
    shortCfgWeight: configuredNumber("DEEPINFRA_CHATTERBOX_SHORT_CFG_WEIGHT", rawCfg ? configuredNumber("DEEPINFRA_CHATTERBOX_CFG_WEIGHT", 0.45, 0, 1) : 0.5, 0, 1),
    hasCustomTemperature: Boolean(rawTemp),
    hasCustomExaggeration: Boolean(rawExagg),
    hasCustomCfgWeight: Boolean(rawCfg),
    cacheDir: getEnv("AUDIO_CACHE_DIR") ?? ".audio-cache",
    cacheMaxMb: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_MB"), 200),
    cacheMaxAgeDays: parsePositiveNumber(getEnv("AUDIO_CACHE_MAX_AGE_DAYS"), 30)
  };
}

export const getDeepInfraConfig = getDeepInfraChatterboxConfig;

export function getDeepInfraStatus() {
  const config = getDeepInfraChatterboxConfig();
  return {
    configured: Boolean(config.apiKey),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
    defaultVoice: config.defaultVoice || "default",
    voicesByLanguage: config.voicesByLanguage,
    outputFormat: config.outputFormat,
    speed: config.speed,
    temperature: config.temperature,
    exaggeration: config.exaggeration,
    cfgWeight: config.cfgWeight,
    topP: config.topP, minP: config.minP, topK: config.topK,
    repetitionPenalty: config.repetitionPenalty, seed: config.seed,
    serviceTier: config.serviceTier, failFast: config.failFast,
    requestTimeoutMs: config.requestTimeoutMs,
    shortTemperature: config.shortTemperature, shortExaggeration: config.shortExaggeration,
    shortCfgWeight: config.shortCfgWeight,
    audioCacheEnabled: Boolean(config.cacheDir)
  };
}

export function getDeepInfraChatterboxStatus() {
  return getDeepInfraStatus();
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
  if (!allowed.includes(value)) throw new TTSConfigError(`${name} must be one of: ${allowed.join(", ")}.`);
  return value;
}
