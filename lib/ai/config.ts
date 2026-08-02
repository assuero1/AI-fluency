import { getEnv, maskSecret } from "@/lib/env";
import { getActiveModelOverride } from "./model-settings";

export async function getAiConfig() {
  const override = await getActiveModelOverride();
  return {
    provider: getEnv("AI_PROVIDER") ?? "openai",
    baseUrl: getEnv("AI_BASE_URL"),
    apiKey: getEnv("AI_API_KEY"),
    chatModel: override.chatModel ?? getEnv("AI_CHAT_MODEL"),
    modelSource: override.chatModel ? ("teable" as const) : ("env" as const),
    temperature: Number(getEnv("AI_TEMPERATURE") ?? 0.4),
    maxTokens: Number(getEnv("AI_MAX_TOKENS") ?? 1200)
  };
}

export async function getAiStatus() {
  const config = await getAiConfig();
  return {
    configured: Boolean(config.baseUrl && config.apiKey && config.chatModel),
    provider: config.provider,
    baseUrlConfigured: Boolean(config.baseUrl),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    chatModelConfigured: Boolean(config.chatModel),
    chatModel: config.chatModel ?? null,
    modelSource: config.modelSource
  };
}
