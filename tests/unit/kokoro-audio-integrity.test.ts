import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeKokoroAudio } from "@/lib/kokoro/audio-integrity";
import { readCachedAudio } from "@/lib/kokoro/cache";

function id3(payload: number[]) {
  const size = payload.length;
  return Buffer.concat([Buffer.from([
    0x49, 0x44, 0x33, 0x04, 0x00, 0x00,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f
  ]), Buffer.from(payload)]);
}

function oggPage(flags: number, payload: string) {
  const bytes = Buffer.from(payload, "ascii");
  const header = Buffer.alloc(28);
  header.write("OggS", 0, "ascii");
  header[5] = flags;
  header[26] = 1;
  header[27] = bytes.byteLength;
  return Buffer.concat([header, bytes]);
}

function opusStream(label: string) {
  return Buffer.concat([
    oggPage(0x02, `OpusHead${label}`),
    oggPage(0x00, "OpusTags"),
    oggPage(0x04, `audio-${label}`)
  ]);
}

describe("Kokoro audio integrity", () => {
  let cacheDir: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = undefined;
  });

  it("keeps only the final complete Ogg/Opus stream and corrects its MIME", () => {
    const first = opusStream("partial");
    const complete = opusStream("complete");
    const normalized = normalizeKokoroAudio(Buffer.concat([first, complete]), "audio/opus", "opus");

    expect(normalized.audio).toEqual(complete);
    expect(normalized.contentType).toBe("audio/ogg");
  });

  it("keeps a single Ogg/Opus stream intact", () => {
    const audio = opusStream("only");
    const normalized = normalizeKokoroAudio(audio, "audio/opus", "opus");

    expect(normalized.audio).toBe(audio);
    expect(normalized.contentType).toBe("audio/ogg");
  });

  it("removes only embedded MP3 ID3 tags and preserves every frame group", () => {
    const firstTag = id3([1, 2]);
    const firstFrames = Buffer.from([0xff, 0xfb, 3, 4]);
    const secondFrames = Buffer.from([0xff, 0xfb, 8, 9]);
    const malformed = Buffer.concat([firstTag, firstFrames, id3([5, 6, 7]), secondFrames]);
    const normalized = normalizeKokoroAudio(malformed, "audio/mpeg", "mp3");

    expect(normalized.audio).toEqual(Buffer.concat([firstTag, firstFrames, secondFrames]));
    expect(normalized.contentType).toBe("audio/mpeg");
  });

  it("repairs an already cached Opus response before serving it", async () => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "kokoro-integrity-"));
    vi.stubEnv("AUDIO_CACHE_DIR", cacheDir);
    const id = "a".repeat(64);
    const fileName = `${id}.opus`;
    const complete = opusStream("complete");
    const malformed = Buffer.concat([opusStream("partial"), complete]);
    writeFileSync(path.join(cacheDir, fileName), malformed);
    writeFileSync(path.join(cacheDir, `${id}.json`), JSON.stringify({
      id, fileName, contentType: "audio/opus", outputFormat: "opus",
      voice: "af_heart", speed: 1.08, createdAt: new Date().toISOString(), bytes: malformed.byteLength
    }));

    const cached = await readCachedAudio(id);

    expect(cached?.audio).toEqual(complete);
    expect(cached?.contentType).toBe("audio/ogg");
  });
});
