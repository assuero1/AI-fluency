import { describe, expect, it } from "vitest";
import { DEFAULT_KOKORO_VOICES, normalizeSpeechLanguage, selectKokoroVoice } from "../../lib/kokoro/voices";

describe("Kokoro voices by language", () => {
  it("maps every onboarding language to a native Kokoro voice", () => {
    expect(selectKokoroVoice("en-US", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("af_heart");
    expect(selectKokoroVoice("es", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("ef_dora");
    expect(selectKokoroVoice("fr-FR", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("ff_siwis");
    expect(selectKokoroVoice("it_IT", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("if_sara");
    expect(selectKokoroVoice("pt-BR", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("pf_dora");
  });

  it("normalizes regional codes and keeps a safe fallback", () => {
    expect(normalizeSpeechLanguage("PT-br")).toBe("pt");
    expect(selectKokoroVoice("de", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("af_heart");
  });
});
