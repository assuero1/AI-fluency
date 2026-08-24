import { describe, expect, it, vi } from "vitest";
import {
  joinSpeechSegments,
  msUntilAudioRouteRestored,
  punctuateSpeechSentence,
  releaseMicForPlayback,
  silentWavUri,
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

  it("joins recognition pauses without inserting commas", () => {
    expect(joinSpeechSegments(["I went to the market", "then I met Ana"], "en")).toBe(
      "I went to the market then I met Ana."
    );
  });

  it("lowercases spurious capitals after a pause inside a sentence", () => {
    expect(joinSpeechSegments(["how was your", "Trip"], "en")).toBe("how was your trip?");
  });

  it("keeps the capital when the previous segment ended a sentence", () => {
    expect(joinSpeechSegments(["I went home.", "Then I slept"], "en")).toBe("I went home. Then I slept.");
  });

  it("reports the remaining wait after the mic is released", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      releaseMicForPlayback();
      expect(msUntilAudioRouteRestored()).toBe(350);
      vi.setSystemTime(1_000_100);
      expect(msUntilAudioRouteRestored()).toBe(250);
      vi.setSystemTime(1_000_400);
      expect(msUntilAudioRouteRestored()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the mic without a browser Audio implementation (nudge is best-effort)", () => {
    expect(() => releaseMicForPlayback()).not.toThrow();
  });

  it("builds a valid silent WAV data URI for the iOS unlock/nudge", () => {
    const uri = silentWavUri();
    expect(uri.startsWith("data:audio/wav;base64,")).toBe(true);
    const bytes = Buffer.from(uri.slice("data:audio/wav;base64,".length), "base64");
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(bytes.length).toBe(44 + 400);
    expect(silentWavUri()).toBe(uri); // cache estável
  });
});
