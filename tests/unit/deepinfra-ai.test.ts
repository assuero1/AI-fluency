import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActiveModelOverride = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/model-settings", () => ({ getActiveModelOverride }));

import { DEEPINFRA_DEFAULT_AI_BASE_URL, DEEPINFRA_DEFAULT_AI_MODEL, getAiConfig, getAiStatus } from "@/lib/ai/config";
import { buildThinkingParams, createChatCompletion, testAiConnection } from "@/lib/ai/client";
import { GET as getModels } from "@/app/api/settings/ai/models/route";

describe("DeepInfra AI provider configuration", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-test-ai-token-12345");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_CHAT_MODEL", "");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: null, source: "env" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses default baseUrl and default model when not explicitly provided", async () => {
    const config = await getAiConfig();
    expect(config.provider).toBe("deepinfra");
    expect(config.baseUrl).toBe(DEEPINFRA_DEFAULT_AI_BASE_URL);
    expect(config.chatModel).toBe(DEEPINFRA_DEFAULT_AI_MODEL);
    expect(config.apiKey).toBe("di-test-ai-token-12345");
  });

  it("reuses DEEPINFRA_TOKEN if DEEPINFRA_API_KEY is unset", async () => {
    vi.stubEnv("DEEPINFRA_API_KEY", "");
    vi.stubEnv("DEEPINFRA_TOKEN", "di-token-from-env");

    const config = await getAiConfig();
    expect(config.apiKey).toBe("di-token-from-env");
  });

  it("prioritizes AI_API_KEY over DEEPINFRA_API_KEY", async () => {
    vi.stubEnv("AI_API_KEY", "specific-ai-key");
    vi.stubEnv("DEEPINFRA_API_KEY", "general-di-key");

    const config = await getAiConfig();
    expect(config.apiKey).toBe("specific-ai-key");
  });

  it("prioritizes AI_BASE_URL over default DeepInfra URL", async () => {
    vi.stubEnv("AI_BASE_URL", "https://custom-proxy.com/v1");

    const config = await getAiConfig();
    expect(config.baseUrl).toBe("https://custom-proxy.com/v1");
  });

  it("allows overriding model via AI_CHAT_MODEL and DEEPINFRA_AI_MODEL", async () => {
    vi.stubEnv("DEEPINFRA_AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct");
    let config = await getAiConfig();
    expect(config.chatModel).toBe("meta-llama/Llama-3.3-70B-Instruct");

    vi.stubEnv("AI_CHAT_MODEL", "deepseek-ai/DeepSeek-R1");
    config = await getAiConfig();
    expect(config.chatModel).toBe("deepseek-ai/DeepSeek-R1");
  });

  it("status reports configured: true and masks key correctly", async () => {
    const status = await getAiStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("deepinfra");
    expect(status.chatModel).toBe(DEEPINFRA_DEFAULT_AI_MODEL);
    expect(status.apiKeyMasked).toBe("di-...2345");
  });
});

describe("buildThinkingParams", () => {
  it("returns thinking disabled for deepseek and other providers", () => {
    expect(buildThinkingParams("deepseek", true)).toEqual({ thinking: { type: "disabled" } });
    expect(buildThinkingParams("DEEPSEEK", true)).toEqual({ thinking: { type: "disabled" } });
    expect(buildThinkingParams("openai", true)).toEqual({ thinking: { type: "disabled" } });
  });

  it("returns reasoning_effort none for deepinfra provider", () => {
    expect(buildThinkingParams("deepinfra", true)).toEqual({ reasoning_effort: "none" });
    expect(buildThinkingParams("DeepInfra", true)).toEqual({ reasoning_effort: "none" });
  });

  it("returns empty object when disableThinking is false or unset", () => {
    expect(buildThinkingParams("deepinfra", false)).toEqual({});
    expect(buildThinkingParams("deepseek", false)).toEqual({});
    expect(buildThinkingParams("deepinfra", undefined)).toEqual({});
  });
});

describe("DeepInfra chat completions & connection", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-token-test");
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_CHAT_MODEL", "deepseek-ai/DeepSeek-V3");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: null, source: "env" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("createChatCompletion calls DeepInfra with reasoning_effort when thinking disabled", async () => {
    let capturedUrl: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    let capturedAuth: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedAuth = String((init?.headers as Record<string, string>)?.Authorization);
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Olá! Tudo bem com você?" } }],
            usage: { total_tokens: 42 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const result = await createChatCompletion(
      [{ role: "user", content: "Olá" }],
      { disableThinking: true }
    );

    expect(capturedUrl).toBe("https://api.deepinfra.com/v1/openai/chat/completions");
    expect(capturedAuth).toBe("Bearer di-token-test");
    expect(capturedBody).toMatchObject({
      model: "deepseek-ai/DeepSeek-V3",
      messages: [{ role: "user", content: "Olá" }],
      reasoning_effort: "none"
    });
    expect((capturedBody as Record<string, unknown> | null)?.thinking).toBeUndefined();

    expect(result.content).toBe("Olá! Tudo bem com você?");
    expect(result.provider).toBe("deepinfra");
    expect(result.model).toBe("deepseek-ai/DeepSeek-V3");
    expect(result.tokensUsed).toBe(42);
  });

  it("testAiConnection calls DeepInfra healthcheck successfully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const result = await testAiConnection();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("deepinfra");
    expect(result.model).toBe("deepseek-ai/DeepSeek-V3");
  });

  it("GET /api/settings/ai/models queries DeepInfra models or falls back to DeepInfra list", async () => {
    // Dynamic provider fetch
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "deepseek-ai/DeepSeek-V3" },
              { id: "meta-llama/Llama-3.3-70B-Instruct" }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    let response = await getModels();
    expect(response.status).toBe(200);
    let body = await response.json();
    expect(body.source).toBe("provider");
    expect(body.models).toEqual(["deepseek-ai/DeepSeek-V3", "meta-llama/Llama-3.3-70B-Instruct"]);

    // Fallback test
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));
    response = await getModels();
    expect(response.status).toBe(200);
    body = await response.json();
    expect(body.source).toBe("fallback");
    expect(body.models).toContain("deepseek-ai/DeepSeek-V3");
    expect(body.models).toContain("meta-llama/Llama-3.3-70B-Instruct");
  });
});
