import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeableConfigError, TeableRequestError } from "@/lib/teable/client";

const mocks = vi.hoisted(() => ({
  saveModelOverride: vi.fn(),
  getActiveModelOverride: vi.fn()
}));

vi.mock("@/lib/ai/model-settings", () => ({
  saveModelOverride: mocks.saveModelOverride,
  getActiveModelOverride: mocks.getActiveModelOverride,
  invalidateModelCache: vi.fn()
}));

import { PUT } from "@/app/api/settings/ai/model/route";

function putRequest(body: unknown) {
  return new Request("http://localhost/api/settings/ai/model", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("PUT /api/settings/ai/model", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test-key-1234");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    mocks.saveModelOverride.mockReset();
    mocks.getActiveModelOverride.mockReset();
    mocks.getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-reasoner", source: "teable" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for an empty model", async () => {
    const response = await PUT(putRequest({ chatModel: "  " }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Informe um modelo válido.");
    expect(mocks.saveModelOverride).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing model field", async () => {
    const response = await PUT(putRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 503 in pt-BR when Teable fails", async () => {
    mocks.saveModelOverride.mockRejectedValue(new TeableRequestError("Teable request failed: 500", 500));
    const response = await PUT(putRequest({ chatModel: "deepseek-reasoner" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Não foi possível salvar o modelo. Tente novamente.");
  });

  it("returns 503 in pt-BR when Teable is not configured", async () => {
    mocks.saveModelOverride.mockRejectedValue(new TeableConfigError("TEABLE_API_KEY is not configured."));
    const response = await PUT(putRequest({ chatModel: "deepseek-reasoner" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Não foi possível salvar o modelo. Tente novamente.");
  });

  it("rethrows unexpected errors", async () => {
    mocks.saveModelOverride.mockRejectedValue(new Error("boom"));
    await expect(PUT(putRequest({ chatModel: "deepseek-reasoner" }))).rejects.toThrow("boom");
  });

  it("saves and returns the updated status", async () => {
    mocks.saveModelOverride.mockResolvedValue(undefined);
    const response = await PUT(putRequest({ chatModel: "deepseek-reasoner" }));
    expect(response.status).toBe(200);
    expect(mocks.saveModelOverride).toHaveBeenCalledWith("deepseek-reasoner");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.status.chatModel).toBe("deepseek-reasoner");
    expect(body.status.modelSource).toBe("teable");
  });
});
