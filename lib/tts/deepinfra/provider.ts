import { normalizeSpeechLanguage } from "@/lib/kokoro/voices";
import type {
  CaptionedSpeechResult,
  StreamedSpeechResult,
  SynthesizedSpeechResult,
  SynthesisRequestOptions,
  TTSConnectionTestResult,
  TTSProvider,
  TTSStatus
} from "@/lib/tts/types";
import {
  captionedDeepInfraSpeech,
  streamDeepInfraSpeech,
  synthesizeDeepInfraSpeech,
  testDeepInfraConnection
} from "./client";
import { getDeepInfraConfig, getDeepInfraStatus } from "./config";

export class DeepInfraTTSProvider implements TTSProvider {
  readonly type = "deepinfra" as const;

  get model(): string {
    return getDeepInfraConfig().model;
  }

  async synthesizeSpeech(input: string, options?: SynthesisRequestOptions): Promise<SynthesizedSpeechResult> {
    return synthesizeDeepInfraSpeech(input, options);
  }

  async captionedSpeech(input: string, options?: SynthesisRequestOptions): Promise<CaptionedSpeechResult> {
    return captionedDeepInfraSpeech(input, options);
  }

  async streamSpeech(input: string, options?: SynthesisRequestOptions): Promise<StreamedSpeechResult> {
    return streamDeepInfraSpeech(input, options);
  }

  async testConnection(): Promise<TTSConnectionTestResult> {
    return testDeepInfraConnection();
  }

  getStatus(): TTSStatus {
    const status = getDeepInfraStatus();
    return {
      provider: "deepinfra",
      configured: status.configured,
      model: status.model,
      apiKeyMasked: status.apiKeyMasked,
      defaultVoice: status.defaultVoice,
      outputFormat: status.outputFormat,
      audioCacheEnabled: status.audioCacheEnabled,
      providerDetails: {
        baseUrl: status.baseUrl,
        apiKeyConfigured: status.apiKeyConfigured,
        voicesByLanguage: status.voicesByLanguage
      }
    };
  }

  resolveVoice(languageCode?: string): string {
    const config = getDeepInfraConfig();
    const lang = normalizeSpeechLanguage(languageCode);
    return config.voicesByLanguage[lang] || config.defaultVoice || "default";
  }

  getSynthesisConfig() {
    const config = getDeepInfraConfig();
    const configuredVoices = Object.values(config.voicesByLanguage).filter(Boolean);
    const allowedVoices = Array.from(new Set(["default", "", config.defaultVoice, ...configuredVoices]));
    return {
      defaultVoice: config.defaultVoice || "default",
      outputFormat: config.outputFormat,
      speed: config.speed,
      allowedVoices,
      allowedFormats: ["mp3", "wav", "opus"]
    };
  }

  getSpeed(): number {
    return getDeepInfraConfig().speed;
  }

  getOutputFormat(): string {
    return getDeepInfraConfig().outputFormat;
  }

  isConfigured(): boolean {
    const config = getDeepInfraConfig();
    return Boolean(config.apiKey);
  }
}
