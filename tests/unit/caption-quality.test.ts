import { describe, expect, it } from "vitest";
import { hasUsableAlignment } from "@/lib/learning/captions";
const word = (start?: number, end?: number) => ({ text: "word", spaceAfter: " ", start, end });
describe("caption quality", () => {
  it("rejects sparse, invalid, reversed and out-of-duration timestamps", () => {
    expect(hasUsableAlignment([word(0, 1), word(), word(), word()])).toBe(false);
    expect(hasUsableAlignment([word(-1, 1)])).toBe(false);
    expect(hasUsableAlignment([word(1, 0)])).toBe(false);
    expect(hasUsableAlignment([word(NaN, 1)])).toBe(false);
    expect(hasUsableAlignment([word(0, 3)], 2)).toBe(false);
    expect(hasUsableAlignment([word(1, 2), word(0, 1)])).toBe(false);
  });
  it("accepts complete alignment and grouped tokens", () => {
    expect(hasUsableAlignment([word(0, 0.5), word(0.5, 1)], 1)).toBe(true);
    expect(hasUsableAlignment([word(0, 0.5), word(0, 0.5)], 1)).toBe(true);
  });
});
