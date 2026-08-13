import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("language level selection UI contracts", () => {
  it("shows level pills on the language switch screen", () => {
    const form = read("components/OnboardingForm.tsx");
    const branch = form.split("if (languageSelectionOnly)")[1] ?? "";
    expect(branch).toContain("Qual seu nível?");
    expect(branch).toContain("LevelPills");
  });

  it("reuses the same level pills in the full onboarding", () => {
    const form = read("components/OnboardingForm.tsx");
    expect(form).not.toContain('const levelOptions');
    expect(form).toContain("LANGUAGE_LEVELS");
  });

  it("pre-fills the saved level of the selected language", () => {
    const form = read("components/OnboardingForm.tsx");
    expect(form).toContain("profileLevels");
    const page = read("app/onboarding/page.tsx");
    expect(page).toContain("profileLevels={profileLevels}");
  });

  it("lets the active profile level be edited from profile preferences", () => {
    const prefs = read("components/ProfilePreferences.tsx");
    expect(prefs).toContain("LevelPills");
    expect(prefs).toContain("savePreference({ level:");
    expect(prefs).toContain("Qual seu nível?");
  });
});
