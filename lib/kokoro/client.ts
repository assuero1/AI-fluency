import { request as httpRequest } from "node:http";
import { connect as connectHttp2 } from "node:http2";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { getKokoroConfig } from "./config";
import { resolveSynthesisRequest, SynthesisValidationError } from "./validation";

import { TTSConfigError, TTSRequestError } from "@/lib/tts/types";

export class KokoroConfigError extends TTSConfigError {}

export class KokoroRequestError extends TTSRequestError {}


function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export async function testKokoroConnection() {
  const config = getKokoroConfig();

  if (!config.baseUrl) throw new KokoroConfigError("KOKORO_BASE_URL is not configured.");
  if (!config.apiKey) throw new KokoroConfigError("KOKORO_API_KEY is not configured.");

  const response = await fetch(`${trimSlash(config.baseUrl)}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "kokoro",
      voice: config.defaultVoice,
      input: "Hello, let's practice today.",
      response_format: config.outputFormat,
      speed: config.speed,
      stream_format: "audio"
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
    throw new KokoroRequestError(`Kokoro request failed: ${response.status}`, response.status, body);
  }

  return {
    ok: true,
    contentType,
    voice: config.defaultVoice,
    outputFormat: config.outputFormat
  };
}

export async function synthesizeSpeech(input: string, options?: { voice?: string; format?: string; speed?: number }) {
  const config = getKokoroConfig();

  if (!config.baseUrl) throw new KokoroConfigError("KOKORO_BASE_URL is not configured.");
  if (!config.apiKey) throw new KokoroConfigError("KOKORO_API_KEY is not configured.");

  let request: ReturnType<typeof resolveSynthesisRequest>;
  try {
    request = resolveSynthesisRequest(input, options, config);
  } catch (error) {
    if (error instanceof SynthesisValidationError) throw new KokoroRequestError(error.message, error.status);
    throw error;
  }
  const response = await fetch(`${trimSlash(config.baseUrl)}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "kokoro",
      voice: request.voice,
      input: request.text,
      response_format: request.outputFormat,
      speed: request.speed,
      stream_format: "audio"
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });

  const contentType = response.headers.get("content-type") ?? `audio/${request.outputFormat}`;

  if (!response.ok) {
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
    throw new KokoroRequestError(`Kokoro request failed: ${response.status}`, response.status, body);
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    ok: true,
    contentType,
    outputFormat: request.outputFormat,
    voice: request.voice,
    audioBuffer: Buffer.from(arrayBuffer)
  };
}

export type WordTimestamp = {
  word: string;
  start_time: number;
  end_time: number;
};

export type CaptionedSpeech = {
  ok: true;
  contentType: string;
  outputFormat: string;
  voice: string;
  audioBuffer: Buffer;
  words: WordTimestamp[];
};

function resolveKokoroLangCode(languageCode?: string, voice?: string): string | undefined {
  if (voice && /^[a-z]_/i.test(voice)) {
    return voice.charAt(0).toLowerCase();
  }
  const lang = languageCode?.toLowerCase().slice(0, 2);
  switch (lang) {
    case "en": return "a";
    case "pt": return "p";
    case "es": return "e";
    case "fr": return "f";
    case "it": return "i";
    case "ja": return "j";
    case "zh": return "z";
    case "hi": return "h";
    default: return undefined;
  }
}

function sanitizeTimestamps(raw: unknown): WordTimestamp[] {
  if (!Array.isArray(raw)) return [];
  const words: WordTimestamp[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).word === "string" &&
      Number.isFinite((item as Record<string, unknown>).start_time) &&
      Number.isFinite((item as Record<string, unknown>).end_time)
    ) {
      words.push({
        word: (item as Record<string, unknown>).word as string,
        start_time: (item as Record<string, unknown>).start_time as number,
        end_time: (item as Record<string, unknown>).end_time as number
      });
    }
  }
  return words;
}

export async function captionedSpeech(
  input: string,
  options?: { voice?: string; format?: string; speed?: number; languageCode?: string }
): Promise<CaptionedSpeech> {
  const config = getKokoroConfig();

  if (!config.baseUrl) throw new KokoroConfigError("KOKORO_BASE_URL is not configured.");
  if (!config.apiKey) throw new KokoroConfigError("KOKORO_API_KEY is not configured.");

  let request: ReturnType<typeof resolveSynthesisRequest>;
  try {
    request = resolveSynthesisRequest(input, options, config);
  } catch (error) {
    if (error instanceof SynthesisValidationError) throw new KokoroRequestError(error.message, error.status);
    throw error;
  }

  const baseUrl = trimSlash(config.baseUrl);
  const langCode = resolveKokoroLangCode(request.languageCode, request.voice);

  const payload: Record<string, unknown> = {
    model: "kokoro",
    voice: request.voice,
    input: request.text,
    response_format: request.outputFormat,
    speed: request.speed,
    return_timestamps: true,
    stream: false
  };
  if (langCode) payload.lang_code = langCode;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/dev/captioned_speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000)
    });
  } catch (networkError) {
    // Falha de rede no endpoint dev: tenta síntese direta no endpoint estável /v1/audio/speech
    try {
      const fallback = await synthesizeSpeech(input, options);
      return {
        ok: true,
        contentType: fallback.contentType,
        outputFormat: fallback.outputFormat,
        voice: fallback.voice,
        audioBuffer: fallback.audioBuffer,
        words: []
      };
    } catch {
      throw networkError;
    }
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    // Se o endpoint de legendas retornar erro (ex.: 404 por versão não-dev ou 500 no alinhador),
    // tenta a síntese padrão estável antes de abortar a experiência do usuário.
    try {
      const fallback = await synthesizeSpeech(input, options);
      return {
        ok: true,
        contentType: fallback.contentType,
        outputFormat: fallback.outputFormat,
        voice: fallback.voice,
        audioBuffer: fallback.audioBuffer,
        words: []
      };
    } catch {
      const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
      throw new KokoroRequestError(`Kokoro captioned request failed: ${response.status}`, response.status, body);
    }
  }

  // Contrato 1: Resposta em JSON com áudio em base64 e timestamps embutidos (upstream recente)
  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as {
        audio?: string;
        audio_format?: string;
        timestamps?: unknown;
      };
      if (typeof data.audio === "string") {
        return {
          ok: true,
          contentType: `audio/${data.audio_format ?? request.outputFormat}`,
          outputFormat: data.audio_format ?? request.outputFormat,
          voice: request.voice,
          audioBuffer: Buffer.from(data.audio, "base64"),
          words: sanitizeTimestamps(data.timestamps)
        };
      }
    } catch {
      // JSON corrompido: fallback para síntese direta
      const fallback = await synthesizeSpeech(input, options);
      return {
        ok: true,
        contentType: fallback.contentType,
        outputFormat: fallback.outputFormat,
        voice: fallback.voice,
        audioBuffer: fallback.audioBuffer,
        words: []
      };
    }
  }

  // Contrato 2: Resposta em áudio binário direto (formato atual da VPS com x-timestamps-path)
  const arrayBuffer = await response.arrayBuffer();
  const timestampsPath = response.headers.get("x-timestamps-path");

  let words: WordTimestamp[] = [];
  if (timestampsPath) {
    try {
      const timestampsResponse = await fetch(`${baseUrl}/dev/timestamps/${encodeURIComponent(timestampsPath)}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
      if (timestampsResponse.ok) {
        const rawJson = await timestampsResponse.json().catch(() => null);
        words = sanitizeTimestamps(rawJson);
      }
    } catch {
      // Se a busca de timestamps falhar ou o JSON na VPS estiver corrompido/truncado,
      // NUNCA rejeita o áudio já baixado com sucesso; degrada graciosamente para words: [].
      words = [];
    }
  }

  return {
    ok: true,
    contentType: contentType || `audio/${request.outputFormat}`,
    outputFormat: request.outputFormat,
    voice: request.voice,
    audioBuffer: Buffer.from(arrayBuffer),
    words
  };
}

export async function streamSpeech(input: string, options?: { voice?: string; format?: string; speed?: number }) {
  const config = getKokoroConfig();

  if (!config.baseUrl) throw new KokoroConfigError("KOKORO_BASE_URL is not configured.");
  if (!config.apiKey) throw new KokoroConfigError("KOKORO_API_KEY is not configured.");

  let request: ReturnType<typeof resolveSynthesisRequest>;
  try {
    request = resolveSynthesisRequest(input, options, config);
  } catch (error) {
    if (error instanceof SynthesisValidationError) throw new KokoroRequestError(error.message, error.status);
    throw error;
  }

  const response = await requestNativeAudioStream(
    `${trimSlash(config.baseUrl)}/v1/audio/speech`,
    config.apiKey,
    {
      model: "kokoro",
      voice: request.voice,
      input: request.text,
      response_format: request.outputFormat,
      speed: request.speed,
      stream_format: "audio"
    }
  );

  const contentType = response.contentType ?? `audio/${request.outputFormat}`;
  if (response.status < 200 || response.status >= 300) {
    const rawBody = await new Response(response.body).text();
    const body = contentType.includes("application/json") ? JSON.parse(rawBody || "null") : rawBody;
    throw new KokoroRequestError(`Kokoro request failed: ${response.status}`, response.status, body);
  }

  return {
    audioStream: response.body,
    contentType,
    outputFormat: request.outputFormat,
    voice: request.voice,
    speed: request.speed
  };
}

function requestNativeAudioStream(urlValue: string, apiKey: string, payload: Record<string, unknown>) {
  const url = new URL(urlValue);
  if (url.protocol === "https:") {
    return requestHttp2AudioStream(url, apiKey, payload).catch(() => requestHttp1AudioStream(url, apiKey, payload));
  }
  return requestHttp1AudioStream(url, apiKey, payload);
}

function requestHttp2AudioStream(url: URL, apiKey: string, payload: Record<string, unknown>) {
  return new Promise<{ status: number; contentType?: string; body: ReadableStream<Uint8Array> }>((resolve, reject) => {
    const body = JSON.stringify(payload);
    const session = connectHttp2(url.origin);
    let settled = false;
    session.once("error", (error) => {
      if (!settled) reject(error);
    });
    const request = session.request({
      ":method": "POST",
      ":path": `${url.pathname}${url.search}`,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    });
    request.setTimeout(45_000, () => request.destroy(new Error("Kokoro HTTP/2 streaming request timed out.")));
    request.once("response", (headers) => {
      settled = true;
      resolve({
        status: Number(headers[":status"] ?? 502),
        contentType: typeof headers["content-type"] === "string" ? headers["content-type"] : undefined,
        body: Readable.toWeb(request) as ReadableStream<Uint8Array>
      });
    });
    request.once("error", (error) => {
      if (!settled) reject(error);
    });
    request.once("close", () => session.close());
    request.end(body);
  });
}

function requestHttp1AudioStream(url: URL, apiKey: string, payload: Record<string, unknown>) {
  return new Promise<{ status: number; contentType?: string; body: ReadableStream<Uint8Array> }>((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (response) => {
      resolve({
        status: response.statusCode ?? 502,
        contentType: Array.isArray(response.headers["content-type"])
          ? response.headers["content-type"][0]
          : response.headers["content-type"],
        body: Readable.toWeb(response) as ReadableStream<Uint8Array>
      });
    });
    request.setTimeout(45_000, () => request.destroy(new Error("Kokoro streaming request timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}
