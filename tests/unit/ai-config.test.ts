import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActiveModelOverride = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/model-settings", () => ({ getActiveModelOverride }));

import { getAiConfig, getAiStatus } from "@/lib/ai/config";

describe("getAiConfig", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: null, source: "env" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the env model when there is no override", async () => {
    const config = await getAiConfig();
    expect(config.chatModel).toBe("env-model");
    expect(config.modelSource).toBe("env");
  });

  it("applies the Teable override over the env model", async () => {
    getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-reasoner", source: "teable" });
    const config = await getAiConfig();
    expect(config.chatModel).toBe("deepseek-reasoner");
    expect(config.modelSource).toBe("teable");
  });
});

describe("getAiStatus", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test-key-1234");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-chat", source: "teable" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes modelSource and the overridden model", async () => {
    const status = await getAiStatus();
    expect(status.configured).toBe(true);
    expect(status.chatModel).toBe("deepseek-chat");
    expect(status.modelSource).toBe("teable");
  });
});
