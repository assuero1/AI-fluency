import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captionedDeepInfraSpeech,
  decodeBase64Audio,
  DeepInfraConfigError,
  DeepInfraRequestError,
  synthesizeDeepInfraSpeech,
  testDeepInfraConnection
} from "@/lib/tts/deepinfra/client";

const SAMPLE_BASE64_AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]).toString("base64");
const SAMPLE_DATA_URL = `data:audio/wav;base64,${SAMPLE_BASE64_AUDIO}`;

describe("DeepInfra Chatterbox client", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPINFRA_API_KEY", "di-test-token");
    vi.stubEnv("DEEPINFRA_BASE_URL", "https://api.deepinfra.test");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_MODEL", "ResembleAI/chatterbox-multilingual");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_OUTPUT_FORMAT", "mp3");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("decodeBase64Audio correctly extracts bytes from raw base64 and data URLs", () => {
    const fromRaw = decodeBase64Audio(SAMPLE_BASE64_AUDIO);
    expect(fromRaw).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]));

    const fromDataUrl = decodeBase64Audio(SAMPLE_DATA_URL);
    expect(fromDataUrl).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]));
  });

  it("testDeepInfraConnection succeeds with a valid 200 response containing audio", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepinfra.test/v1/inference/ResembleAI/chatterbox-multilingual");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer di-test-token",
        "Content-Type": "application/json"
      });
      return new Response(JSON.stringify({ audio: SAMPLE_DATA_URL }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testDeepInfraConnection();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("deepinfra");
    expect(result.outputFormat).toBe("mp3");
  });

  it("testDeepInfraConnection succeeds with a direct binary audio/wav response", async () => {
    const rawBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rawBytes, {
      status: 200,
      headers: { "content-type": "audio/wav" }
    })));

    const result = await testDeepInfraConnection();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("deepinfra");
    expect(result.outputFormat).toBe("mp3");
  });

  it("testDeepInfraConnection throws DeepInfraConfigError when API key is missing", async () => {
    vi.stubEnv("DEEPINFRA_API_KEY", "");
    vi.stubEnv("DEEPINFRA_TOKEN", "");
    await expect(testDeepInfraConnection()).rejects.toBeInstanceOf(DeepInfraConfigError);
  });

  it("testDeepInfraConnection throws DeepInfraRequestError when upstream returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Invalid API key" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })));

    await expect(testDeepInfraConnection()).rejects.toMatchObject({
      status: 401
    });
  });

  it("testDeepInfraConnection throws when audio is missing in response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    await expect(testDeepInfraConnection()).rejects.toBeInstanceOf(DeepInfraRequestError);
  });

  it("synthesizeDeepInfraSpeech validates empty or oversized input", async () => {
    await expect(synthesizeDeepInfraSpeech("   ")).rejects.toMatchObject({ status: 400 });
    await expect(synthesizeDeepInfraSpeech("a".repeat(1201))).rejects.toMatchObject({ status: 413 });
  });

  it("synthesizeDeepInfraSpeech sends correct language and parameters to DeepInfra", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    vi.stubEnv("DEEPINFRA_CHATTERBOX_VOICE_PT", "pt-voice-id");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_EXAGGERATION", "0.5");

    const result = await synthesizeDeepInfraSpeech("Olá, vamos praticar hoje.", {
      languageCode: "pt-BR",
      speed: 1.1
    });

    expect(result.ok).toBe(true);
    expect(result.outputFormat).toBe("mp3");
    expect(result.voice).toBe("pt-voice-id");
    expect(result.audioBuffer).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]));

    expect(capturedBody).toMatchObject({
      text: "Olá, vamos praticar hoje.",
      language_id: "pt",
      language: "pt",
      response_format: "mp3",
      voice_id: "pt-voice-id",
      speed: 1.1,
      exaggeration: 0.5
    });
  });

  it("synthesizeDeepInfraSpeech processes direct binary audio response", async () => {
    const rawAudioBytes = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rawAudioBytes, {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    })));

    const result = await synthesizeDeepInfraSpeech("Direct binary test", { languageCode: "en" });
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.audioBuffer).toEqual(rawAudioBytes);
  });

  it("captionedDeepInfraSpeech returns audio buffer with empty words array for fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const result = await captionedDeepInfraSpeech("Hello world", { languageCode: "en" });
    expect(result.ok).toBe(true);
    expect(result.words).toEqual([]);
    expect(result.audioBuffer).toEqual(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]));
  });

  it("captionedDeepInfraSpeech extracts word timestamps returned by DeepInfra", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      audio: SAMPLE_BASE64_AUDIO,
      words: [
        { id: 1, start: 0.12, end: 0.45, text: "Olá" },
        { id: 2, start: 0.48, end: 0.95, text: "mundo" }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const result = await captionedDeepInfraSpeech("Olá mundo", { languageCode: "pt" });
    expect(result.ok).toBe(true);
    expect(result.words).toEqual([
      { word: "Olá", start_time: 0.12, end_time: 0.45 },
      { word: "mundo", start_time: 0.48, end_time: 0.95 }
    ]);
  });

  it("synthesizeDeepInfraSpeech supports opus output format", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ audio: SAMPLE_BASE64_AUDIO }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    const result = await synthesizeDeepInfraSpeech("Opus test", { format: "opus", languageCode: "en" });
    expect(result.ok).toBe(true);
    expect(result.outputFormat).toBe("opus");
    expect(result.contentType).toBe("audio/opus");
    expect(capturedBody).toMatchObject({
      response_format: "opus"
    });
  });
});
