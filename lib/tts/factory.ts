import { getEnv } from "@/lib/env";
import { DeepInfraTTSProvider } from "./deepinfra/provider";
import { KokoroTTSProvider } from "./kokoro/provider";
import type { TTSConnectionTestResult, TTSProvider, TTSProviderType, TTSStatus } from "./types";

const kokoroProvider = new KokoroTTSProvider();
const deepInfraProvider = new DeepInfraTTSProvider();

export function getActiveTTSProviderType(): TTSProviderType {
  const configured = getEnv("TTS_PROVIDER")?.trim().toLowerCase();
  if (configured === "deepinfra" || configured === "chatterbox") {
    return "deepinfra";
  }
  return "kokoro";
}

export function getActiveTTSProvider(): TTSProvider {
  const type = getActiveTTSProviderType();
  if (type === "deepinfra") {
    return deepInfraProvider;
  }
  return kokoroProvider;
}

export function getTTSStatus(): TTSStatus {
  return getActiveTTSProvider().getStatus();
}

export async function testTTSConnection(): Promise<TTSConnectionTestResult> {
  return getActiveTTSProvider().testConnection();
}
