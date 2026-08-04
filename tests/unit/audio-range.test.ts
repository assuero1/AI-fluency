import { describe, expect, it } from "vitest";
import { parseByteRangeHeader } from "../../lib/kokoro/audio-range";

describe("parseByteRangeHeader", () => {
  it("parses an explicit byte interval", () => {
    expect(parseByteRangeHeader("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
  });

  it("supports open-ended and suffix intervals", () => {
    expect(parseByteRangeHeader("bytes=6-", 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRangeHeader("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  });

  it("clamps an explicit end to the available bytes", () => {
    expect(parseByteRangeHeader("bytes=8-99", 10)).toEqual({ start: 8, end: 9 });
  });

  it("distinguishes missing and invalid range headers", () => {
    expect(parseByteRangeHeader(null, 10)).toBeNull();
    expect(parseByteRangeHeader("bytes=10-", 10)).toBe("invalid");
    expect(parseByteRangeHeader("bytes=0-1,3-4", 10)).toBe("invalid");
  });
});
