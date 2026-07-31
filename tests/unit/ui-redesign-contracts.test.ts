import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("chunky playful redesign contracts", () => {
  it("loads Nunito via next/font and applies it as the app font", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("next/font/google");
    expect(layout).toContain("Nunito");
    expect(layout).toContain("--font-nunito");
    expect(read("app/globals.css")).toContain("var(--font-nunito)");
  });

  it("uses the new brand color in the PWA theme", () => {
    expect(read("app/layout.tsx")).toContain('themeColor: "#58cc02"');
  });
});
