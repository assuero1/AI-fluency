import { getEnv, getFirstEnv, maskSecret } from "@/lib/env";
import { getActiveModelOverride } from "./model-settings";

export const DEEPINFRA_DEFAULT_AI_BASE_URL = "https://api.deepinfra.com/v1/openai";
export const DEEPINFRA_DEFAULT_AI_MODEL = "deepseek-ai/DeepSeek-V3";

export async function getAiConfig() {
  const override = await getActiveModelOverride();
  const provider = (getEnv("AI_PROVIDER") ?? "openai").toLowerCase();
  const isDeepInfra = provider === "deepinfra";

  const baseUrl = getEnv("AI_BASE_URL") ?? (isDeepInfra ? DEEPINFRA_DEFAULT_AI_BASE_URL : undefined);
  const apiKey = getEnv("AI_API_KEY") ?? (isDeepInfra ? getFirstEnv(["DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"]) : undefined);
  const chatModel =
    override.chatModel ??
    getEnv("AI_CHAT_MODEL") ??
    (isDeepInfra ? (getEnv("DEEPINFRA_AI_MODEL") ?? DEEPINFRA_DEFAULT_AI_MODEL) : undefined);

  return {
    provider,
    baseUrl,
    apiKey,
    chatModel,
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
