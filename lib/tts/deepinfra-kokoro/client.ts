import { TTSConfigError, TTSRequestError, type CaptionedSpeechResult, type StreamedSpeechResult, type SynthesizedSpeechResult, type TTSConnectionTestResult, type SynthesisRequestOptions, type WordTimestamp } from "@/lib/tts/types";
import { normalizeSpeechLanguage } from "@/lib/kokoro/voices";
import { getDeepInfraKokoroConfig } from "@/lib/tts/deepinfra-kokoro/config";

export class DeepInfraKokoroConfigError extends TTSConfigError {}
export class DeepInfraKokoroRequestError extends TTSRequestError {}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isBinaryContentType(contentType: string) {
  return contentType.startsWith("audio/") || contentType.includes("application/octet-stream");
}

function parseErrorResponse(response: Response, contentType: string) {
  const body = contentType.includes("application/json") ? response.json().catch(() => null) : response.text();
  return body.then((payload) => new DeepInfraKokoroRequestError(`DeepInfra Kokoro request failed: ${response.status}`, response.status, payload));
}

function decodeResponseAudio(raw: string): Buffer {
  const cleaned = raw.includes(",") ? raw.split(",")[1] : raw;
  return Buffer.from(cleaned, "base64");
}

export async function extractAudioData(
  response: Response,
  contentType: string
): Promise<{ audioBuffer: Buffer; words: WordTimestamp[] }> {
  if (isBinaryContentType(contentType)) {
    const arrayBuffer = await response.arrayBuffer();
    return { audioBuffer: Buffer.from(arrayBuffer), words: [] };
  }

  const payload = (await response.json().catch(() => null)) as {
    audio?: string;
    words?: Array<{ word?: string; text?: string; start_time?: number; end_time?: number; start?: number; end?: number }>;
    error?: unknown;
  } | null;

  if (!payload?.audio) {
    throw new DeepInfraKokoroRequestError("DeepInfra Kokoro response did not contain audio data.", 502, payload);
  }

  const words: WordTimestamp[] = Array.isArray(payload.words)
    ? payload.words
      .map((entry) => ({
        word: String(entry.text ?? entry.word ?? "").trim(),
        start_time: Number(entry.start ?? entry.start_time ?? 0),
        end_time: Number(entry.end ?? entry.end_time ?? 0)
      }))
      .filter((entry) => Boolean(entry.word) && Number.isFinite(entry.start_time) && Number.isFinite(entry.end_time))
    : [];

  return {
    audioBuffer: decodeResponseAudio(payload.audio),
    words
  };
}

export function buildDeepInfraKokoroPayload(input: string, options?: SynthesisRequestOptions) {
  const config = getDeepInfraKokoroConfig();
  const language = normalizeSpeechLanguage(options?.languageCode) as keyof typeof config.voicesByLanguage;
  const text = input.trim();
  const outputFormat = (options?.format || config.outputFormat).toLowerCase();
  const voice = options?.voice || config.voicesByLanguage[language] || config.defaultVoice;

  return {
    text,
    ...(voice && voice !== "default" ? { preset_voice: [voice] } : {}),
    output_format: outputFormat,
    ...(options?.speed && Number.isFinite(options.speed) ? { speed: options.speed } : { speed: config.speed }),
    service_tier: config.serviceTier
  };
}

export async function testDeepInfraKokoroConnection(): Promise<TTSConnectionTestResult> {
  const config = getDeepInfraKokoroConfig();

  if (!config.apiKey) {
    throw new DeepInfraKokoroConfigError("DEEPINFRA_API_KEY is not configured.");
  }

  const endpoint = `${trimSlash(config.baseUrl)}/v1/inference/${config.model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildDeepInfraKokoroPayload("Hello, let's practice today.", { languageCode: "en" })),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw await parseErrorResponse(response, contentType);

  if (!isBinaryContentType(contentType)) {
    const payload = (await response.json().catch(() => null)) as { audio?: string; error?: unknown } | null;
    if (!payload?.audio) {
      throw new DeepInfraKokoroRequestError("DeepInfra Kokoro response did not contain audio data.", 502, payload);
    }
  }

  return {
    ok: true,
    provider: "deepinfra-kokoro",
    contentType: `audio/${config.outputFormat}`,
    voice: config.defaultVoice || "default",
    outputFormat: config.outputFormat
  };
}

export async function synthesizeDeepInfraKokoroSpeech(
  input: string,
  options?: SynthesisRequestOptions
): Promise<SynthesizedSpeechResult> {
  const config = getDeepInfraKokoroConfig();

  if (!config.apiKey) {
    throw new DeepInfraKokoroConfigError("DEEPINFRA_API_KEY is not configured.");
  }

  const text = input.trim();
  if (!text) throw new DeepInfraKokoroRequestError("Text is required for speech synthesis.", 400);
  if (text.length > 1200) throw new DeepInfraKokoroRequestError("Text is too long for speech synthesis.", 413);

  const outputFormat = (options?.format || config.outputFormat).toLowerCase();
  const payload = buildDeepInfraKokoroPayload(text, options);
  const response = await fetch(`${trimSlash(config.baseUrl)}/v1/inference/${config.model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw await parseErrorResponse(response, contentType);
  }

  const { audioBuffer } = await extractAudioData(response, contentType);
  const finalContentType = contentType.startsWith("audio/") ? contentType : `audio/${outputFormat}`;

  return {
    ok: true,
    contentType: finalContentType,
    outputFormat,
    voice: payload.preset_voice?.[0] || config.defaultVoice || "default",
    audioBuffer
  };
}

export async function captionedDeepInfraKokoroSpeech(
  input: string,
  options?: SynthesisRequestOptions
): Promise<CaptionedSpeechResult> {
  const result = await synthesizeDeepInfraKokoroSpeech(input, options);
  return {
    ...result,
    words: result.words ?? []
  };
}

export async function streamDeepInfraKokoroSpeech(
  input: string,
  options?: SynthesisRequestOptions
): Promise<StreamedSpeechResult> {
  const config = getDeepInfraKokoroConfig();

  if (!config.apiKey) {
    throw new DeepInfraKokoroConfigError("DEEPINFRA_API_KEY is not configured.");
  }

  const text = input.trim();
  if (!text) throw new DeepInfraKokoroRequestError("Text is required for speech synthesis.", 400);
  if (text.length > 1200) throw new DeepInfraKokoroRequestError("Text is too long for speech synthesis.", 413);

  const outputFormat = (options?.format || config.outputFormat).toLowerCase();
  const payload = { ...buildDeepInfraKokoroPayload(text, options), stream: true };
  const response = await fetch(`${trimSlash(config.baseUrl)}/v1/inference/${config.model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw await parseErrorResponse(response, contentType);
  }

  const isBinary = isBinaryContentType(contentType);
  const finalContentType = isBinary && contentType.startsWith("audio/") ? contentType : `audio/${outputFormat}`;

  if (isBinary && response.body) {
    return {
      audioStream: response.body,
      contentType: finalContentType,
      outputFormat,
      voice: payload.preset_voice?.[0] || config.defaultVoice || "default",
      speed: options?.speed ?? config.speed
    };
  }

  const { audioBuffer } = await extractAudioData(response, contentType);
  return {
    audioStream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(audioBuffer));
        controller.close();
      }
    }),
    contentType: finalContentType,
    outputFormat,
    voice: payload.preset_voice?.[0] || config.defaultVoice || "default",
    speed: options?.speed ?? config.speed
  };
}
