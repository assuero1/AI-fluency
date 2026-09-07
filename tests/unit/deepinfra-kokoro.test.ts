import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDeepInfraKokoroPayload } from "@/lib/tts/deepinfra-kokoro/client";

describe("DeepInfra Kokoro native inference contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the selected language voice with the native Kokoro field names", () => {
    vi.stubEnv("DEEPINFRA_KOKORO_VOICE_PT", "pf_dora");
    vi.stubEnv("DEEPINFRA_KOKORO_OUTPUT_FORMAT", "opus");
    vi.stubEnv("DEEPINFRA_KOKORO_SPEED", "1");
    vi.stubEnv("DEEPINFRA_KOKORO_SERVICE_TIER", "priority");

    expect(buildDeepInfraKokoroPayload(" Olá, tudo bem? ", { languageCode: "pt-BR" })).toEqual({
      text: "Olá, tudo bem?",
      preset_voice: ["pf_dora"],
      output_format: "opus",
      speed: 1,
      service_tier: "priority"
    });
  });
});
