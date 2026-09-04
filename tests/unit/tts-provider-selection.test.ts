import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST as postSynthesize } from "@/app/api/voice/synthesize/route";
import { POST as postCaptioned } from "@/app/api/voice/captioned/route";
import { POST as postTestTTS } from "@/app/api/settings/test-tts/route";
import { createAudioId } from "@/lib/kokoro/cache";
import { getActiveTTSProvider, getActiveTTSProviderType, getTTSStatus } from "@/lib/tts/factory";

const SAMPLE_BASE64_AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]).toString("base64");

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("TTS Provider Selection and Cache Isolation", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "tts-selection-"));
    vi.stubEnv("AUDIO_CACHE_DIR", cacheDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("defaults to kokoro when TTS_PROVIDER is undefined", () => {
    vi.stubEnv("TTS_PROVIDER", "");
    expect(getActiveTTSProviderType()).toBe("kokoro");
    expect(getActiveTTSProvider().type).toBe("kokoro");
  });

  it("selects deepinfra when TTS_PROVIDER=deepinfra or chatterbox", () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    expect(getActiveTTSProviderType()).toBe("deepinfra");
    expect(getActiveTTSProvider().type).toBe("deepinfra");

    vi.stubEnv("TTS_PROVIDER", "chatterbox");
    expect(getActiveTTSProviderType()).toBe("deepinfra");
  });

  it("segregates audioId cache hashes between kokoro and deepinfra", () => {
    const text = "Hello, world!";
    const voice = "af_heart";
    const format = "mp3";
    const speed = 1.0;

    const kokoroId = createAudioId(text, voice, format, speed, "kokoro");
    const deepInfraId = createAudioId(text, voice, format, speed, "deepinfra");

    expect(kokoroId).not.toBe(deepInfraId);
    expect(kokoroId).toMatch(/^[a-f0-9]{64}$/);
    expect(deepInfraId).toMatch(/^[a-f0-9]{64}$/);

    // Kokoro default matches legacy call without provider arg
    const legacyKokoroId = createAudioId(text, voice, format, speed);
    expect(legacyKokoroId).toBe(kokoroId);

    // DeepInfra differentiates languages with the same text and voice
    const deepInfraPt = createAudioId(text, voice, format, speed, "deepinfra", "pt");
    const deepInfraEs = createAudioId(text, voice, format, speed, "deepinfra", "es");
    expect(deepInfraPt).not.toBe(deepInfraEs);
    expect(deepInfraPt).not.toBe(deepInfraId);
  });

  it("getTTSStatus returns correct provider details", () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "test-key-12345678");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_MODEL", "ResembleAI/chatterbox-multilingual");

    const status = getTTSStatus();
    expect(status.provider).toBe("deepinfra");
    expect(status.configured).toBe(true);
    expect(status.model).toBe("ResembleAI/chatterbox-multilingual");
    expect(status.apiKeyMasked).toBe("tes...5678");
  });

  it("POST /api/settings/test-tts routes to deepinfra when selected", async () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-key");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const response = await postTestTTS();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; provider: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("deepinfra");
  });

  it("POST /api/voice/synthesize works with deepinfra provider", async () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-key");

    let calledUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    const response = await postSynthesize(jsonRequest("http://localhost/api/voice/synthesize", {
      text: "Testing deepinfra synthesize",
      languageCode: "en"
    }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; audioUrl: string; languageCode: string };
    expect(body.ok).toBe(true);
    expect(body.languageCode).toBe("en");
    expect(body.audioUrl).toMatch(/^\/api\/voice\/[a-f0-9]{64}$/);
    expect(calledUrl).toContain("api.deepinfra.com/v1/inference/ResembleAI/chatterbox-multilingual");
  });

  it("POST /api/voice/captioned works with deepinfra provider and returns words: []", async () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-key");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const response = await postCaptioned(jsonRequest("http://localhost/api/voice/captioned", {
      text: "Testing captioned deepinfra",
      languageCode: "pt"
    }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; audioUrl: string; words: unknown[]; languageCode: string };
    expect(body.ok).toBe(true);
    expect(body.languageCode).toBe("pt");
    expect(body.words).toEqual([]);
    expect(body.audioUrl).toMatch(/^\/api\/voice\/[a-f0-9]{64}$/);
  });

  it("POST /api/voice/captioned works with deepinfra provider and returns parsed words when provided", async () => {
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
    vi.stubEnv("DEEPINFRA_API_KEY", "di-key");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      audio: SAMPLE_BASE64_AUDIO,
      words: [
        { id: 1, start: 0.05, end: 0.35, text: "Olá" },
        { id: 2, start: 0.38, end: 0.8, text: "amigo" }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const response = await postCaptioned(jsonRequest("http://localhost/api/voice/captioned", {
      text: "Olá amigo",
      languageCode: "pt"
    }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; audioUrl: string; words: unknown[]; languageCode: string };
    expect(body.ok).toBe(true);
    expect(body.languageCode).toBe("pt");
    expect(body.words).toEqual([
      { word: "Olá", start_time: 0.05, end_time: 0.35 },
      { word: "amigo", start_time: 0.38, end_time: 0.8 }
    ]);
  });
});
