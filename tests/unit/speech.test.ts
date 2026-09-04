import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(speechLocale("ja")).toBe("ja-JP");
    expect(speechLocale("zh")).toBe("zh-CN");
    expect(speechLocale("hi")).toBe("hi-IN");
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
    expect(punctuateSpeechSentence("元気ですか", "ja")).toBe("元気ですか?");
    expect(punctuateSpeechSentence("你好吗", "zh")).toBe("你好吗?");
    expect(punctuateSpeechSentence("क्या आप ठीक हैं", "hi")).toBe("क्या आप ठीक हैं?");
  });

  it("joins recognition pauses without inserting commas", () => {
    expect(joinSpeechSegments(["I went to the market", "then I met Ana"], "en")).toBe(
      "I went to the market then I met Ana."
    );
    expect(joinSpeechSegments(["こんにちは", "元気ですか"], "ja")).toBe("こんにちは元気ですか?");
    expect(joinSpeechSegments(["你好", "我想学习"], "zh")).toBe("你好我想学习.");
    expect(joinSpeechSegments(["नमस्ते", "आप कैसे हैं"], "hi")).toBe("नमस्ते आप कैसे हैं?");
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
      expect(msUntilAudioRouteRestored()).toBe(800);
      vi.setSystemTime(1_000_100);
      expect(msUntilAudioRouteRestored()).toBe(700);
      vi.setSystemTime(1_000_800);
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

/**
 * O nudge de rota depende de um <audio> dedicado destravado dentro de um gesto
 * do usuário; cada teste abaixo usa um módulo fresco (vi.resetModules) para
 * não compartilhar o estado de módulo (routeNudgeAudio/micReleasedAt).
 */
describe("route nudge element", () => {
  class FakeAudio {
    static instances: FakeAudio[] = [];
    src = "";
    muted = false;
    volume = 1;
    paused = true;
    playCount = 0;
    constructor() {
      FakeAudio.instances.push(this);
    }
    async play() {
      this.playCount += 1;
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }

  beforeEach(() => {
    vi.resetModules();
    FakeAudio.instances = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function freshSpeech() {
    return import("../../lib/learning/speech");
  }

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("prepares a dedicated nudge element inside the user gesture (muted unlock)", async () => {
    const speech = await freshSpeech();
    speech.prepareRouteNudgeElement();
    expect(FakeAudio.instances).toHaveLength(1);
    const element = FakeAudio.instances[0];
    expect(element.src).toBe(silentWavUri());
    expect(element.muted).toBe(true);
    expect(element.playCount).toBe(1);
    await flushMicrotasks();
    expect(element.paused).toBe(true);
    expect(element.muted).toBe(false);
  });

  it("reuses the prepared element across unlocks instead of stacking elements", async () => {
    const speech = await freshSpeech();
    speech.prepareRouteNudgeElement();
    speech.prepareRouteNudgeElement();
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("plays the prepared element unmuted when the mic is released", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5_000_000);
      const speech = await freshSpeech();
      speech.prepareRouteNudgeElement();
      const element = FakeAudio.instances[0];
      await flushMicrotasks();
      const playsAfterPrepare = element.playCount;
      speech.releaseMicForPlayback();
      expect(element.playCount).toBe(playsAfterPrepare + 1);
      expect(element.muted).toBe(false);
      expect(element.src).toBe(silentWavUri());
      expect(speech.msUntilAudioRouteRestored()).toBe(800);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still attempts a best-effort nudge on a fresh element without preparation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5_000_000);
      const speech = await freshSpeech();
      speech.releaseMicForPlayback();
      expect(FakeAudio.instances).toHaveLength(1);
      expect(FakeAudio.instances[0].playCount).toBe(1);
      expect(FakeAudio.instances[0].muted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
