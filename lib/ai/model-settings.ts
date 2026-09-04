import { getEnv } from "@/lib/env";
import { getTeableClient } from "@/lib/supabase/client";

type AiProviderSettingsFields = {
  provider?: string;
  chat_model?: string;
  is_active?: boolean;
};

export type ModelOverride = {
  chatModel: string | null;
  source: "teable" | "env";
};

const CACHE_TTL_MS = 60_000;

let cache: { value: ModelOverride; expiresAt: number } | null = null;

export function invalidateModelCache() {
  cache = null;
}

function pickActiveRow(records: Array<{ id: string; createdTime?: string; fields: AiProviderSettingsFields }>) {
  return records
    .filter((record) => record.fields.is_active === true)
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""))[0];
}

export async function getActiveModelOverride(): Promise<ModelOverride> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  let value: ModelOverride = { chatModel: null, source: "env" };
  try {
    const client = getTeableClient();
    const records = await client.listRecords<AiProviderSettingsFields>("aiProviderSettings", 100);
    const active = pickActiveRow(records);
    const rowProvider = active?.fields.provider?.trim();
    const envProvider = (getEnv("AI_PROVIDER") ?? "openai").toLowerCase();
    // Linhas sem provider (legadas) continuam valendo; provider divergente do env é ignorado.
    const providerMatches = !rowProvider || rowProvider.toLowerCase() === envProvider;
    const chatModel = providerMatches ? active?.fields.chat_model?.trim() : undefined;
    if (chatModel) value = { chatModel, source: "teable" };
  } catch {
    // Banco indisponível: fallback silencioso para env.
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveModelOverride(chatModel: string) {
  const envProvider = (getEnv("AI_PROVIDER") ?? "openai").toLowerCase();
  const client = getTeableClient();
  const records = await client.listRecords<AiProviderSettingsFields>("aiProviderSettings", 100);
  const active = pickActiveRow(records);

  if (active) {
    await client.updateRecord<AiProviderSettingsFields>("aiProviderSettings", active.id, {
      chat_model: chatModel,
      provider: envProvider
    });
  } else {
    await client.createRecord<AiProviderSettingsFields>("aiProviderSettings", {
      provider: envProvider,
      chat_model: chatModel,
      is_active: true
    });
  }

  invalidateModelCache();
}
