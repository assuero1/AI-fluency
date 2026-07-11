import { request as httpRequest } from "node:http";
import { connect as connectHttp2 } from "node:http2";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { getKokoroConfig } from "./config";
import { resolveSynthesisRequest, SynthesisValidationError } from "./validation";

export class KokoroConfigError extends Error {
  status = 503;
}

export class KokoroRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}

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
    signal: AbortSignal.timeout(12_000)
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
