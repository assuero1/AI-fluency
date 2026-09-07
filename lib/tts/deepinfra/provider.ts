import {
  getDeepInfraChatterboxConfig,
  getDeepInfraChatterboxStatus,
  getDeepInfraStatus
} from "@/lib/tts/deepinfra/config";
import {
  captionedDeepInfraSpeech,
  streamDeepInfraSpeech,
  synthesizeDeepInfraSpeech,
  testDeepInfraConnection
} from "@/lib/tts/deepinfra/client";
import { selectKokoroVoice } from "@/lib/kokoro/voices";
import type {
  CaptionedSpeechResult,
  StreamedSpeechResult,
  SynthesizedSpeechResult,
  SynthesisRequestOptions,
  TTSConnectionTestResult,
  TTSProvider,
  TTSProviderDescriptor,
  TTSStatus
} from "@/lib/tts/types";

export class DeepInfraTTSProvider implements TTSProvider {
  readonly type = "deepinfra-chatterbox" as const;

  get model() {
    return getDeepInfraChatterboxConfig().model;
  }

  get descriptor(): TTSProviderDescriptor {
    const config = getDeepInfraChatterboxConfig();
    return {
      id: this.type,
      vendor: "deepinfra",
      model: config.model,
      capabilities: {
        supportsStreaming: true,
        supportsWordTimestamps: true,
        requiresBufferedNormalization: false
      },
      cacheVersion: "di-chatterbox-v1"
    };
  }

  async synthesizeSpeech(input: string, options?: SynthesisRequestOptions): Promise<SynthesizedSpeechResult> {
    return synthesizeDeepInfraSpeech(input, options);
  }

  async captionedSpeech(input: string, options?: SynthesisRequestOptions): Promise<CaptionedSpeechResult> {
    const result = await captionedDeepInfraSpeech(input, options);
    return {
      ok: true,
      contentType: result.contentType,
      outputFormat: result.outputFormat,
      voice: result.voice,
      audioBuffer: result.audioBuffer,
      words: result.words
    };
  }

  async streamSpeech(input: string, options?: SynthesisRequestOptions): Promise<StreamedSpeechResult> {
    const result = await streamDeepInfraSpeech(input, options);
    return {
      audioStream: result.audioStream,
      contentType: result.contentType,
      outputFormat: result.outputFormat,
      voice: result.voice,
      speed: result.speed
    };
  }

  async testConnection(): Promise<TTSConnectionTestResult> {
    const result = await testDeepInfraConnection();
    return {
      ok: true,
      provider: this.type,
      contentType: result.contentType,
      voice: result.voice,
      outputFormat: result.outputFormat
    };
  }

  getStatus(): TTSStatus {
    const status = getDeepInfraChatterboxStatus();
    return {
      provider: this.type,
      configured: status.configured,
      model: status.model,
      apiKeyMasked: status.apiKeyMasked,
      defaultVoice: status.defaultVoice,
      outputFormat: status.outputFormat,
      audioCacheEnabled: status.audioCacheEnabled,
      providerDetails: {
        baseUrl: status.baseUrl,
        model: status.model,
        serviceTier: status.serviceTier,
        voicesByLanguage: status.voicesByLanguage,
        speed: status.speed
      }
    };
  }

  resolveVoice(languageCode?: string): string {
    const config = getDeepInfraChatterboxConfig();
    return selectKokoroVoice(languageCode, config.voicesByLanguage, config.defaultVoice);
  }

  getSynthesisConfig() {
    const config = getDeepInfraChatterboxConfig();
    return {
      defaultVoice: config.defaultVoice,
      outputFormat: config.outputFormat,
      speed: config.speed,
      allowedVoices: Object.values(config.voicesByLanguage),
      allowedFormats: [config.outputFormat]
    };
  }

  getSpeed(): number {
    return getDeepInfraChatterboxConfig().speed;
  }

  getOutputFormat(): string {
    return getDeepInfraChatterboxConfig().outputFormat;
  }

  isConfigured(): boolean {
    return getDeepInfraStatus().configured;
  }
}
