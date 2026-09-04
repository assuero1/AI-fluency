import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { synthesizeSpeech } = vi.hoisted(() => ({ synthesizeSpeech: vi.fn() }));
vi.mock("../../lib/kokoro/client", () => ({
  synthesizeSpeech,
  KokoroConfigError: class extends Error {},
  KokoroRequestError: class extends Error {},
  streamSpeech: vi.fn(),
  captionedSpeech: vi.fn()
}));

describe("warmCachedSpeech", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "kokoro-warm-"));
    synthesizeSpeech.mockReset();
    synthesizeSpeech.mockResolvedValue({ ok: true, contentType: "audio/mpeg", outputFormat: "mp3", voice: "af_heart", audioBuffer: Buffer.alloc(8) });
    vi.stubEnv("KOKORO_BASE_URL", "https://kokoro.test");
    vi.stubEnv("KOKORO_API_KEY", "sk-test");
    vi.stubEnv("KOKORO_DEFAULT_VOICE", "af_heart");
    vi.stubEnv("KOKORO_OUTPUT_FORMAT", "mp3");
    vi.stubEnv("KOKORO_SPEED", "1.08");
    vi.stubEnv("KOKORO_VOICE_EN", "af_heart");
    vi.stubEnv("KOKORO_VOICE_ES", "ef_dora");
    vi.stubEnv("KOKORO_VOICE_FR", "ff_siwis");
    vi.stubEnv("KOKORO_VOICE_IT", "if_sara");
    vi.stubEnv("KOKORO_VOICE_PT", "pf_dora");
    vi.stubEnv("AUDIO_CACHE_DIR", cacheDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("sintetiza todos os textos e engole erros individuais", async () => {
    synthesizeSpeech.mockRejectedValueOnce(new Error("kokoro caiu"));
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await expect(warmCachedSpeech(["a", "b", "c", "d"], "en")).resolves.toBeUndefined();
    expect(synthesizeSpeech).toHaveBeenCalledTimes(4);
  });

  it("ignora lista vazia", async () => {
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await expect(warmCachedSpeech([], "en")).resolves.toBeUndefined();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("retorna cedo sem Kokoro configurado", async () => {
    vi.stubEnv("KOKORO_BASE_URL", "");
    vi.stubEnv("KOKORO_API_KEY", "");
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await expect(warmCachedSpeech(["a"], "en")).resolves.toBeUndefined();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("limita a concorrência de síntese", async () => {
    let active = 0;
    let maxActive = 0;
    synthesizeSpeech.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, contentType: "audio/mpeg", outputFormat: "mp3", voice: "af_heart", audioBuffer: Buffer.alloc(1) };
    });
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await warmCachedSpeech(["a", "b", "c", "d", "e", "f"], "en");
    expect(synthesizeSpeech).toHaveBeenCalledTimes(6);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("resolve voz/formato/speed igual à rota /api/voice/synthesize", async () => {
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await warmCachedSpeech(["Bom dia."], "pt-BR");
    // Língua não suportada cai para "en", mesmo fallback da rota.
    await warmCachedSpeech(["Hello."], "de");
    // Língua suportada nova (japonês) resolve para sua voz configurada.
    await warmCachedSpeech(["こんにちは。"], "ja");
    const calls = synthesizeSpeech.mock.calls as unknown as Array<[string, { voice: string; format: string; speed: number }]>;
    expect(calls[0][1]).toEqual({ voice: "pf_dora", format: "mp3", speed: 1.08 });
    expect(calls[1][1]).toEqual({ voice: "af_heart", format: "mp3", speed: 1.08 });
    expect(calls[2][1]).toEqual({ voice: "jf_alpha", format: "mp3", speed: 1.08 });
  });
});
