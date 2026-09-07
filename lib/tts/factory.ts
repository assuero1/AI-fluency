import { getEnv } from "@/lib/env";
import { DeepInfraTTSProvider } from "./deepinfra/provider";
import { DeepInfraKokoroTTSProvider } from "./deepinfra-kokoro/provider";
import { KokoroTTSProvider } from "./kokoro/provider";
import { TTSConfigError, type TTSConnectionTestResult, type TTSProvider, type TTSProviderType, type TTSStatus } from "./types";

const providers: Record<TTSProviderType, TTSProvider> = {
  "kokoro-vps": new KokoroTTSProvider(),
  "deepinfra-kokoro": new DeepInfraKokoroTTSProvider(),
  "deepinfra-chatterbox": new DeepInfraTTSProvider()
};

function normalizeTTSProviderType(value: string | undefined): TTSProviderType {
  const normalized = (value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "":
      return "kokoro-vps";
    case "kokoro":
    case "kokoro-vps":
      return "kokoro-vps";
    case "deepinfra-kokoro":
      return "deepinfra-kokoro";
    case "deepinfra":
    case "chatterbox":
    case "deepinfra-chatterbox":
      return "deepinfra-chatterbox";
    default:
      throw new TTSConfigError(`Unknown TTS_PROVIDER: ${value}`);
  }
}

export function getActiveTTSProviderType(): TTSProviderType {
  const configured = getEnv("TTS_PROVIDER");
  return normalizeTTSProviderType(configured);
}

export function getActiveTTSProvider(): TTSProvider {
  const type = getActiveTTSProviderType();
  return providers[type];
}

export function getTTSStatus(): TTSStatus {
  return getActiveTTSProvider().getStatus();
}

export async function testTTSConnection(): Promise<TTSConnectionTestResult> {
  return getActiveTTSProvider().testConnection();
}
