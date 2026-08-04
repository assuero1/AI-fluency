import { describe, expect, it, vi } from "vitest";
import { requestTranslation } from "../../lib/learning/translation-request";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("requestTranslation", () => {
  it("retries a transient upstream failure before surfacing an error", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { ok: false, error: "Upstream service unreachable." }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, translation: "Vamos praticar." }));

    await expect(requestTranslation("Let's practice.", "en", { fetcher, retryDelayMs: 0 })).resolves.toBe("Vamos praticar.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries when the upstream response is not valid JSON", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("temporary gateway error", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, translation: "Olá." }));

    await expect(requestTranslation("Hello.", "en", { fetcher, retryDelayMs: 0 })).resolves.toBe("Olá.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a validation error", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, error: "Informe uma frase para traduzir." }));

    await expect(requestTranslation("", "en", { fetcher, retryDelayMs: 0 })).rejects.toThrow("Informe uma frase para traduzir.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
