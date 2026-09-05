import { captionedSpeech, streamSpeech, synthesizeSpeech, testKokoroConnection } from "@/lib/kokoro/client";
import { getKokoroConfig, getKokoroStatus } from "@/lib/kokoro/config";
import { selectKokoroVoice } from "@/lib/kokoro/voices";
import type {
  CaptionedSpeechResult,
  StreamedSpeechResult,
  SynthesizedSpeechResult,
  SynthesisRequestOptions,
  TTSConnectionTestResult,
  TTSProvider,
  TTSStatus
} from "@/lib/tts/types";

export class KokoroTTSProvider implements TTSProvider {
  readonly type = "kokoro" as const;
  readonly model = "kokoro";

  async synthesizeSpeech(input: string, options?: SynthesisRequestOptions): Promise<SynthesizedSpeechResult> {
    const result = await synthesizeSpeech(input, options);
    return {
      ok: true,
      contentType: result.contentType,
      outputFormat: result.outputFormat,
      voice: result.voice,
      audioBuffer: result.audioBuffer
    };
  }

  async captionedSpeech(input: string, options?: SynthesisRequestOptions): Promise<CaptionedSpeechResult> {
    const result = await captionedSpeech(input, options);
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
    const result = await streamSpeech(input, options);
    return {
      audioStream: result.audioStream,
      contentType: result.contentType,
      outputFormat: result.outputFormat,
      voice: result.voice,
      speed: result.speed
    };
  }

  async testConnection(): Promise<TTSConnectionTestResult> {
    const result = await testKokoroConnection();
    return {
      ok: true,
      provider: "kokoro",
      contentType: result.contentType,
      voice: result.voice,
      outputFormat: result.outputFormat
    };
  }

  getStatus(): TTSStatus {
    const status = getKokoroStatus();
    return {
      provider: "kokoro",
      configured: status.configured,
      model: "kokoro",
      apiKeyMasked: status.apiKeyMasked,
      defaultVoice: status.defaultVoice,
      outputFormat: status.outputFormat,
      audioCacheEnabled: status.audioCacheEnabled,
      providerDetails: {
        baseUrlConfigured: status.baseUrlConfigured,
        apiKeyConfigured: status.apiKeyConfigured,
        voicesByLanguage: status.voicesByLanguage
      }
    };
  }

  resolveVoice(languageCode?: string): string {
    const config = getKokoroConfig();
    return selectKokoroVoice(languageCode, config.voicesByLanguage, config.defaultVoice);
  }

  getSynthesisConfig() {
    return getKokoroConfig();
  }

  getSpeed(): number {
    return getKokoroConfig().speed;
  }

  getOutputFormat(): string {
    return getKokoroConfig().outputFormat;
  }

  isConfigured(): boolean {
    const config = getKokoroConfig();
    return Boolean(config.baseUrl && config.apiKey);
  }
}

