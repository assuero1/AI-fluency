import { describe, expect, it } from "vitest";
import { speechLanguageName, speechLocale, speechRecognitionErrorMessage } from "../../lib/learning/speech";

describe("native speech recognition locale", () => {
  it("maps every onboarding language to its expected locale", () => {
    expect(speechLocale("en")).toBe("en-US");
    expect(speechLocale("es")).toBe("es-ES");
    expect(speechLocale("fr")).toBe("fr-FR");
    expect(speechLocale("it")).toBe("it-IT");
  });

  it("keeps a stable English fallback for an unsupported code", () => {
    expect(speechLocale("de")).toBe("en-US");
    expect(speechLanguageName("de")).toBe("inglês (Estados Unidos)");
  });

  it("keeps microphone errors actionable without blocking typing", () => {
    expect(speechRecognitionErrorMessage("not-allowed")).toContain("digitar normalmente");
    expect(speechRecognitionErrorMessage("no-speech")).toContain("Tente novamente");
    expect(speechRecognitionErrorMessage("aborted")).toBeNull();
  });
});
