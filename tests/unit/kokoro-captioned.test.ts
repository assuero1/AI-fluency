import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST } from "@/app/api/voice/captioned/route";
import { captionedSpeech, KokoroConfigError, KokoroRequestError, type WordTimestamp } from "@/lib/kokoro/client";

const WORDS: WordTimestamp[] = [
  { word: "Hello", start_time: 0.25, end_time: 0.525 },
  { word: "there", start_time: 0.525, end_time: 0.75 },
  { word: ".", start_time: 0.75, end_time: 0.825 }
];

function mockKokoroFetch(options?: { captionedStatus?: number; captionedContentType?: string; timestampsPath?: string | null; words?: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/dev/captioned_speech")) {
      const headers: Record<string, string> = { "content-type": options?.captionedContentType ?? "audio/mpeg" };
      if (options?.timestampsPath !== null) headers["x-timestamps-path"] = options?.timestampsPath ?? "tmp123.json";
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: options?.captionedStatus ?? 200, headers });
    }
    if (url.includes("/dev/timestamps/")) {
      return new Response(JSON.stringify(options?.words ?? WORDS), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonPost(body: unknown) {
  return new Request("http://localhost/api/voice/captioned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("captionedSpeech client", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns audio buffer and word timestamps on success", async () => {
    const fetchMock = mockKokoroFetch();
    const result = await captionedSpeech("Hello there.", { voice: "af_heart" });

    expect(result.audioBuffer).toEqual(Buffer.from([0x49, 0x44, 0x33]));
    expect(result.words).toEqual(WORDS);
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.voice).toBe("af_heart");

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const speechCall = calls[0];
    const timestampsCall = calls[1];
    expect(String(speechCall[0])).toBe("https://kokoro.test/dev/captioned_speech");
    const payload = JSON.parse(String(speechCall[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ model: "kokoro", voice: "af_heart", input: "Hello there.", response_format: "mp3", return_timestamps: true });
    expect(String(timestampsCall[0])).toBe("https://kokoro.test/dev/timestamps/tmp123.json");
  });

  it("throws KokoroRequestError when the upstream captioned request fails", async () => {
    mockKokoroFetch({ captionedStatus: 500, captionedContentType: "text/plain" });
    await expect(captionedSpeech("Hello", { voice: "af_heart" })).rejects.toMatchObject({ status: 500 });
  });

  it("throws when the captioned response has no timestamps path", async () => {
    mockKokoroFetch({ timestampsPath: null });
    await expect(captionedSpeech("Hello", { voice: "af_heart" })).rejects.toMatchObject({ status: 502 });
  });

  it("throws when the timestamps payload has an invalid shape", async () => {
    mockKokoroFetch({ words: { not: "an array" } });
    await expect(captionedSpeech("Hello", { voice: "af_heart" })).rejects.toMatchObject({ status: 502 });
  });

  it("throws KokoroConfigError when Kokoro is not configured", async () => {
    vi.stubEnv("KOKORO_BASE_URL", "");
    vi.stubEnv("KOKORO_API_KEY", "");
    mockKokoroFetch();
    await expect(captionedSpeech("Hello", { voice: "af_heart" })).rejects.toBeInstanceOf(KokoroConfigError);
  });

  it("throws KokoroRequestError for validation problems", async () => {
    mockKokoroFetch();
    await expect(captionedSpeech("", { voice: "af_heart" })).rejects.toBeInstanceOf(KokoroRequestError);
  });
});

describe("POST /api/voice/captioned", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "kokoro-captioned-"));
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
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns audioUrl, words and languageCode for a valid request", async () => {
    mockKokoroFetch();
    const response = await POST(jsonPost({ text: "Hello there.", languageCode: "en" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; languageCode: string; audioUrl: string; words: WordTimestamp[]; cached: boolean };
    expect(body.ok).toBe(true);
    expect(body.languageCode).toBe("en");
    expect(body.audioUrl).toMatch(/^\/api\/voice\/[a-f0-9]{64}$/);
    expect(body.words).toEqual(WORDS);
    expect(body.cached).toBe(false);
  });

  it("serves the second identical request from cache", async () => {
    mockKokoroFetch();
    await POST(jsonPost({ text: "Hello there.", languageCode: "en" }));
    const response = await POST(jsonPost({ text: "Hello there.", languageCode: "en" }));
    const body = (await response.json()) as { cached: boolean; words: WordTimestamp[] };
    expect(response.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.words).toEqual(WORDS);
  });

  it("rejects empty text with 400", async () => {
    mockKokoroFetch();
    const response = await POST(jsonPost({ text: "   ", languageCode: "en" }));
    expect(response.status).toBe(400);
  });

  it("rejects oversized text with 413", async () => {
    mockKokoroFetch();
    const response = await POST(jsonPost({ text: "a".repeat(1201), languageCode: "en" }));
    expect(response.status).toBe(413);
  });

  it("rejects a voice outside the allowlist with 400", async () => {
    vi.stubEnv("KOKORO_ALLOWED_VOICES", "ff_siwis");
    mockKokoroFetch();
    const response = await POST(jsonPost({ text: "Hello there.", languageCode: "en" }));
    expect(response.status).toBe(400);
  });
});
