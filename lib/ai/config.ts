import { getEnv, maskSecret } from "@/lib/env";

export function getAiConfig() {
  return {
    provider: getEnv("AI_PROVIDER") ?? "openai",
    baseUrl: getEnv("AI_BASE_URL"),
    apiKey: getEnv("AI_API_KEY"),
    chatModel: getEnv("AI_CHAT_MODEL"),
    temperature: Number(getEnv("AI_TEMPERATURE") ?? 0.4),
    maxTokens: Number(getEnv("AI_MAX_TOKENS") ?? 1200)
  };
}

export function getAiStatus() {
  const config = getAiConfig();
  return {
    configured: Boolean(config.baseUrl && config.apiKey && config.chatModel),
    provider: config.provider,
    baseUrlConfigured: Boolean(config.baseUrl),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    chatModelConfigured: Boolean(config.chatModel),
    chatModel: config.chatModel ?? null
  };
}
