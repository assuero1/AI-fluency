import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAudioId, getOrCreateCachedSpeech, prepareCaptionedSpeech } from "@/lib/kokoro/cache";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "chatterbox-dedupe-"));
  vi.stubEnv("AUDIO_CACHE_DIR", directory);
  vi.stubEnv("TTS_PROVIDER", "deepinfra");
  vi.stubEnv("DEEPINFRA_API_KEY", "test-only");
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

describe("one Chatterbox asset for speech and captions", () => {
  it("deduplicates simultaneous captioned and plain requests and remembers absent timestamps", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ audio: Buffer.from("test audio").toString("base64") }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const options = { languageCode: "en" };
    const [plain, captioned] = await Promise.all([
      getOrCreateCachedSpeech("One generation.", options),
      prepareCaptionedSpeech("One generation.", options)
    ]);
    expect(plain.audioUrl).toBe(captioned.audioUrl);
    expect(captioned.words).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const replay = await prepareCaptionedSpeech("One generation.", options);
    expect(replay.cached).toBe(true);
    expect(replay.words).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves native timestamps from a plain synthesis for later captioned playback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ audio: Buffer.from("test audio").toString("base64"), words: [{ word: "Hello", start: 0.1, end: 0.8 }] }), { headers: { "content-type": "application/json" } })));
    const plain = await getOrCreateCachedSpeech("Hello.", { languageCode: "en" });
    const captioned = await prepareCaptionedSpeech("Hello.", { languageCode: "en" });
    expect(captioned.audioUrl).toBe(plain.audioUrl);
    expect(captioned.words).toEqual([{ word: "Hello", start_time: 0.1, end_time: 0.8 }]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("changes the cache identity when model or prosody changes, but normalizes equivalent speech", () => {
    const id = () => createAudioId("Hello", "default", "mp3", 1, "deepinfra", "en");
    const original = id();
    expect(original).toBe(createAudioId("Hello.", "default", "mp3", 1, "deepinfra", "en"));
    vi.stubEnv("DEEPINFRA_CHATTERBOX_MODEL", "test/model-v2");
    expect(id()).not.toBe(original);
    const model = id();
    vi.stubEnv("DEEPINFRA_CHATTERBOX_EXAGGERATION", "0.2");
    expect(id()).not.toBe(model);
  });
});
