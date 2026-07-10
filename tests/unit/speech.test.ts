import { describe, expect, it } from "vitest";
import {
  joinSpeechSegments,
  punctuateSpeechSentence,
  speechLanguageName,
  speechLocale,
  speechRecognitionErrorMessage
} from "../../lib/learning/speech";

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

  it("adds punctuation to questions in every supported language", () => {
    expect(punctuateSpeechSentence("how was your trip", "en")).toBe("how was your trip?");
    expect(punctuateSpeechSentence("cómo fue tu viaje", "es")).toBe("cómo fue tu viaje?");
    expect(punctuateSpeechSentence("pourquoi tu apprends le français", "fr")).toBe("pourquoi tu apprends le français?");
    expect(punctuateSpeechSentence("come è stato il viaggio", "it")).toBe("come è stato il viaggio?");
  });

  it("turns recognition pauses into readable punctuation", () => {
    expect(joinSpeechSegments(["I went to the market", "then I met Ana"], "en")).toBe(
      "I went to the market, then I met Ana."
    );
  });
});
