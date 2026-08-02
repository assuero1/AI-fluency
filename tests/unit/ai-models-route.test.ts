import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/settings/ai/models/route";

describe("GET /api/settings/ai/models", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sorted unique models from the provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }, { id: "deepseek-chat" }, {}] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"], source: "provider" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.deepseek.com/v1/models");
  });

  it("falls back to the static provider list when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"], source: "fallback" });
  });

  it("falls back when the payload has an unexpected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ weird: true }), { status: 200 })));
    const response = await GET();
    const body = await response.json();
    expect(body.source).toBe("fallback");
  });

  it("returns 503 when AI is not configured", async () => {
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Configure a IA no servidor primeiro.");
  });
});
