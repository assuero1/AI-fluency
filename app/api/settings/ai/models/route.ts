import { jsonError, jsonOk } from "@/lib/api/responses";
import { getAiConfig } from "@/lib/ai/config";

// A lista reflete a configuração do servidor e o provedor em tempo real.
export const dynamic = "force-dynamic";

const FALLBACK_MODELS: Record<string, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  deepinfra: [
    "deepseek-ai/DeepSeek-V3",
    "deepseek-ai/DeepSeek-R1",
    "meta-llama/Llama-3.3-70B-Instruct",
    "Qwen/Qwen2.5-72B-Instruct",
    "mistralai/Mistral-Small-24B-Instruct-2501"
  ],
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5", "deepseek/deepseek-chat"],
  custom: []
};

export async function GET() {
  const config = await getAiConfig();
  const { baseUrl, apiKey, provider } = config;

  if (!baseUrl || !apiKey) {
    return jsonError("Configure a IA no servidor primeiro.", 503);
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);

    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = [
      ...new Set((body.data ?? []).map((entry) => (typeof entry.id === "string" ? entry.id.trim() : "")).filter(Boolean))
    ].sort();
    if (models.length === 0) throw new Error("Unexpected models payload.");

    return jsonOk({ ok: true, models, source: "provider" });
  } catch {
    return jsonOk({ ok: true, models: FALLBACK_MODELS[provider] ?? FALLBACK_MODELS.custom, source: "fallback" });
  }
}
