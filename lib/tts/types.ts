export type TTSProviderType = "kokoro" | "deepinfra";

export class TTSConfigError extends Error {
  status = 503;
}

export class TTSRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}

export type WordTimestamp = {
  word: string;
  start_time: number;
  end_time: number;
};

export type SynthesisRequestOptions = {
  voice?: string;
  format?: string;
  speed?: number;
  languageCode?: string;
};

export type SynthesizedSpeechResult = {
  ok: true;
  contentType: string;
  outputFormat: string;
  voice: string;
  audioBuffer: Buffer;
  words?: WordTimestamp[];
};

export type CaptionedSpeechResult = {
  ok: true;
  contentType: string;
  outputFormat: string;
  voice: string;
  audioBuffer: Buffer;
  words: WordTimestamp[];
};

export type TTSConnectionTestResult = {
  ok: boolean;
  provider: TTSProviderType;
  contentType?: string;
  voice?: string;
  outputFormat?: string;
  message?: string;
};

export type TTSStatus = {
  provider: TTSProviderType;
  configured: boolean;
  model: string;
  apiKeyMasked: string | null;
  defaultVoice: string;
  outputFormat: string;
  audioCacheEnabled: boolean;
  providerDetails?: Record<string, unknown>;
};

export type SynthesisConfig = {
  defaultVoice: string;
  outputFormat: string;
  speed?: number;
  allowedVoices: string[];
  allowedFormats: string[];
};

export type StreamedSpeechResult = {
  audioStream: ReadableStream<Uint8Array>;
  contentType: string;
  outputFormat: string;
  voice: string;
  speed?: number;
};

export interface TTSProvider {
  readonly type: TTSProviderType;
  readonly model: string;
  synthesizeSpeech(input: string, options?: SynthesisRequestOptions): Promise<SynthesizedSpeechResult>;
  captionedSpeech(input: string, options?: SynthesisRequestOptions): Promise<CaptionedSpeechResult>;
  streamSpeech?(input: string, options?: SynthesisRequestOptions): Promise<StreamedSpeechResult>;
  testConnection(): Promise<TTSConnectionTestResult>;
  getStatus(): TTSStatus;
  resolveVoice(languageCode?: string): string;
  getSynthesisConfig(): SynthesisConfig;
  getSpeed(): number;
  getOutputFormat(): string;
  isConfigured(): boolean;
}

