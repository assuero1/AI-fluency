import { TTSConfigError, TTSRequestError, type CaptionedSpeechResult, type SynthesizedSpeechResult, type TTSConnectionTestResult, type SynthesisRequestOptions } from "@/lib/tts/types";
import { normalizeSpeechLanguage } from "@/lib/kokoro/voices";
import { getDeepInfraConfig } from "./config";

export class DeepInfraConfigError extends TTSConfigError {}

export class DeepInfraRequestError extends TTSRequestError {}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function decodeBase64Audio(raw: string): Buffer {
  const cleaned = raw.includes(",") ? raw.split(",")[1] : raw;
  return Buffer.from(cleaned, "base64");
}

export async function extractAudioBuffer(
  response: Response,
  contentType: string
): Promise<Buffer> {
  const isBinary =
    contentType.startsWith("audio/") ||
    contentType.includes("application/octet-stream");

  if (isBinary) {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const data = (await response.json().catch(() => null)) as { audio?: string; error?: unknown } | null;
  if (!data?.audio) {
    throw new DeepInfraRequestError("DeepInfra response did not contain audio data.", 502, data);
  }

  return decodeBase64Audio(data.audio);
}

export async function testDeepInfraConnection(): Promise<TTSConnectionTestResult> {
  const config = getDeepInfraConfig();

  if (!config.apiKey) {
    throw new DeepInfraConfigError("DEEPINFRA_API_KEY is not configured.");
  }

  const endpoint = `${trimSlash(config.baseUrl)}/v1/inference/${config.model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: "Hello, let's practice today.",
      language: "en",
      ...(config.defaultVoice ? { voice_id: config.defaultVoice } : {})
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
    throw new DeepInfraRequestError(`DeepInfra request failed: ${response.status}`, response.status, body);
  }

  const isBinary = contentType.startsWith("audio/") || contentType.includes("application/octet-stream");
  if (!isBinary) {
    const data = (await response.json().catch(() => null)) as { audio?: string; error?: unknown } | null;
    if (!data?.audio) {
      throw new DeepInfraRequestError("DeepInfra response did not contain audio data.", 502, data);
    }
  }

  return {
    ok: true,
    provider: "deepinfra",
    contentType: `audio/${config.outputFormat}`,
    voice: config.defaultVoice || "default",
    outputFormat: config.outputFormat
  };
}

export async function synthesizeDeepInfraSpeech(
  input: string,
  options?: SynthesisRequestOptions
): Promise<SynthesizedSpeechResult> {
  const config = getDeepInfraConfig();

  if (!config.apiKey) {
    throw new DeepInfraConfigError("DEEPINFRA_API_KEY is not configured.");
  }

  const text = input.trim();
  if (!text) {
    throw new DeepInfraRequestError("Text is required for speech synthesis.", 400);
  }
  if (text.length > 1200) {
    throw new DeepInfraRequestError("Text is too long for speech synthesis.", 413);
  }

  const lang = normalizeSpeechLanguage(options?.languageCode);
  const voice = options?.voice || config.voicesByLanguage[lang] || config.defaultVoice || "";
  const outputFormat = (options?.format || config.outputFormat).toLowerCase();

  const payload: Record<string, unknown> = {
    text,
    language: lang
  };

  if (voice) {
    payload.voice_id = voice;
  }
  if (options?.speed && Number.isFinite(options.speed)) {
    payload.speed = options.speed;
  }
  if (config.exaggeration !== undefined) {
    payload.exaggeration = config.exaggeration;
  }
  if (config.cfgWeight !== undefined) {
    payload.cfg_weight = config.cfgWeight;
  }

  const endpoint = `${trimSlash(config.baseUrl)}/v1/inference/${config.model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(35_000)
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
    throw new DeepInfraRequestError(`DeepInfra request failed: ${response.status}`, response.status, body);
  }

  const audioBuffer = await extractAudioBuffer(response, contentType);
  const finalContentType = contentType.startsWith("audio/") ? contentType : `audio/${outputFormat}`;

  return {
    ok: true,
    contentType: finalContentType,
    outputFormat,
    voice: voice || "default",
    audioBuffer
  };
}

export async function captionedDeepInfraSpeech(
  input: string,
  options?: SynthesisRequestOptions
): Promise<CaptionedSpeechResult> {
  const result = await synthesizeDeepInfraSpeech(input, options);
  return {
    ...result,
    words: []
  };
}
