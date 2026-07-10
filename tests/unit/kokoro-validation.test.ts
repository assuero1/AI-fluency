import { describe, expect, it } from "vitest";
import { createAudioId, isAudioId } from "../../lib/kokoro/cache";
import { resolveSynthesisRequest, SynthesisValidationError } from "../../lib/kokoro/validation";

const config = {
  defaultVoice: "af_bella",
  outputFormat: "mp3",
  allowedVoices: ["af_bella"],
  allowedFormats: ["mp3"]
};

describe("Kokoro synthesis boundary", () => {
  it("uses a deterministic cache id for equal normalized requests", () => {
    const first = createAudioId("café", "af_bella", "mp3");
    const second = createAudioId("cafe\u0301", "af_bella", "mp3");
    expect(first).toBe(second);
    expect(createAudioId("café", "af_bella", "mp3", 1.08)).not.toBe(first);
    expect(isAudioId(first)).toBe(true);
    expect(isAudioId("../not-an-audio-id")).toBe(false);
  });

  it("allows only configured voice and format values", () => {
    expect(resolveSynthesisRequest("Hello", undefined, config)).toEqual({ text: "Hello", voice: "af_bella", outputFormat: "mp3", speed: 1 });
    expect(() => resolveSynthesisRequest("Hello", { voice: "unknown" }, config)).toThrow(SynthesisValidationError);
    expect(() => resolveSynthesisRequest("Hello", { format: "wav" }, config)).toThrow(SynthesisValidationError);
    expect(() => resolveSynthesisRequest("Hello", { speed: 5 }, config)).toThrow(SynthesisValidationError);
  });

  it("rejects empty and oversized synthesis input", () => {
    expect(() => resolveSynthesisRequest("  ", undefined, config)).toThrow(SynthesisValidationError);
    expect(() => resolveSynthesisRequest("a".repeat(1201), undefined, config)).toThrow(SynthesisValidationError);
  });
});
