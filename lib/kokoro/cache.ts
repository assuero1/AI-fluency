import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { KokoroRequestError, streamSpeech, synthesizeSpeech } from "./client";
import { getKokoroConfig } from "./config";
import { resolveSynthesisRequest, SynthesisValidationError } from "./validation";
import { normalizeSpeechLanguage, selectKokoroVoice } from "./voices";

type CachedAudioMetadata = {
  id: string;
  fileName: string;
  contentType: string;
  outputFormat: string;
  voice: string;
  speed: number;
  createdAt: string;
  bytes: number;
};

type CachedSpeech = {
  audioId: string;
  audioUrl: string;
  contentType: string;
  outputFormat: string;
  voice: string;
  cached: boolean;
};

type PendingSpeech = {
  id: string;
  text: string;
  voice: string;
  outputFormat: string;
  speed: number;
  expiresAt: number;
};

const inFlight = new Map<string, Promise<CachedSpeech>>();
const pendingSpeech = new Map<string, PendingSpeech>();
let lastPendingPruneAt = 0;

export async function warmKokoroLanguage(languageCode: string | undefined) {
  const config = getKokoroConfig();
  if (!config.baseUrl || !config.apiKey) return;
  const language = normalizeSpeechLanguage(languageCode);
  const greetings: Record<string, string> = {
    en: "Hello!",
    es: "¡Hola!",
    fr: "Bonjour !",
    it: "Ciao!",
    pt: "Olá!"
  };
  const voice = selectKokoroVoice(language, config.voicesByLanguage, config.defaultVoice);
  await getOrCreateCachedSpeech(greetings[language] ?? greetings.en, {
    voice,
    format: config.outputFormat,
    speed: config.speed
  });
}

export async function prepareCachedSpeech(input: string, options?: { voice?: string; format?: string; speed?: number }): Promise<CachedSpeech> {
  const config = getKokoroConfig();
  let request: ReturnType<typeof resolveSynthesisRequest>;
  try {
    request = resolveSynthesisRequest(input, options, config);
  } catch (error) {
    if (error instanceof SynthesisValidationError) throw new KokoroRequestError(error.message, error.status);
    throw error;
  }
  const audioId = createAudioId(request.text, request.voice, request.outputFormat, request.speed);
  const cached = await getCachedSpeech(audioId);
  if (cached) return { ...cached, cached: true };

  const now = Date.now();
  for (const [id, pending] of pendingSpeech) {
    if (pending.expiresAt <= now) pendingSpeech.delete(id);
  }
  const pending = { id: audioId, ...request, expiresAt: now + 5 * 60 * 1000 };
  pendingSpeech.set(audioId, pending);
  await mkdir(config.cacheDir, { recursive: true });
  await writeFile(path.join(config.cacheDir, `${audioId}.pending.json`), JSON.stringify(pending), { mode: 0o600 });
  if (now - lastPendingPruneAt > 60_000) {
    lastPendingPruneAt = now;
    void prunePendingSpeech(config.cacheDir, now).catch(() => undefined);
  }
  return {
    audioId,
    audioUrl: `/api/voice/${audioId}`,
    contentType: contentTypeFor(request.outputFormat),
    outputFormat: request.outputFormat,
    voice: request.voice,
    cached: false
  };
}

export async function getOrCreateCachedSpeech(input: string, options?: { voice?: string; format?: string; speed?: number }): Promise<CachedSpeech> {
  const config = getKokoroConfig();
  let request: ReturnType<typeof resolveSynthesisRequest>;
  try {
    request = resolveSynthesisRequest(input, options, config);
  } catch (error) {
    if (error instanceof SynthesisValidationError) throw new KokoroRequestError(error.message, error.status);
    throw error;
  }
  const audioId = createAudioId(request.text, request.voice, request.outputFormat, request.speed);
  const cached = await getCachedSpeech(audioId);
  if (cached) return { ...cached, cached: true };

  const current = inFlight.get(audioId);
  if (current) return current;

  const task = createCachedSpeech({ audioId, ...request });
  inFlight.set(audioId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(audioId);
  }
}

export async function getCachedSpeech(audioId: string): Promise<Omit<CachedSpeech, "cached"> | null> {
  if (!isAudioId(audioId)) return null;
  const { cacheDir } = getKokoroConfig();
  const metadata = await readMetadata(cacheDir, audioId);
  if (!metadata) return null;

  const filePath = path.join(cacheDir, metadata.fileName);
  try {
    const info = await stat(filePath);
    const maxAgeMs = getKokoroConfig().cacheMaxAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - info.mtimeMs > maxAgeMs) {
      await removeCachedFiles(cacheDir, metadata).catch(() => undefined);
      return null;
    }
    await utimes(filePath, new Date(), new Date()).catch(() => undefined);
    return {
      audioId,
      audioUrl: `/api/voice/${audioId}`,
      contentType: metadata.contentType,
      outputFormat: metadata.outputFormat,
      voice: metadata.voice
    };
  } catch {
    await rm(path.join(cacheDir, `${audioId}.json`), { force: true }).catch(() => undefined);
    return null;
  }
}

export async function readCachedAudio(audioId: string) {
  if (!isAudioId(audioId)) return null;
  const { cacheDir } = getKokoroConfig();
  const metadata = await readMetadata(cacheDir, audioId);
  if (!metadata) return null;
  const filePath = path.join(cacheDir, metadata.fileName);

  try {
    const info = await stat(filePath);
    const maxAgeMs = getKokoroConfig().cacheMaxAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - info.mtimeMs > maxAgeMs) {
      await removeCachedFiles(cacheDir, metadata).catch(() => undefined);
      return null;
    }
    const audio = await readFile(filePath);
    await utimes(filePath, new Date(), new Date()).catch(() => undefined);
    return { audio, contentType: metadata.contentType, fileName: metadata.fileName };
  } catch {
    return null;
  }
}

export async function streamPendingAudio(audioId: string) {
  if (!isAudioId(audioId)) return null;
  const { cacheDir } = getKokoroConfig();
  const pending = pendingSpeech.get(audioId) ?? await readPendingSpeech(cacheDir, audioId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingSpeech.delete(audioId);
    await rm(path.join(cacheDir, `${audioId}.pending.json`), { force: true }).catch(() => undefined);
    return null;
  }
  pendingSpeech.delete(audioId);
  await rm(path.join(cacheDir, `${audioId}.pending.json`), { force: true }).catch(() => undefined);

  const result = await streamSpeech(pending.text, {
    voice: pending.voice,
    format: pending.outputFormat,
    speed: pending.speed
  });
  const [playbackStream, cacheStream] = result.audioStream.tee();
  void persistStreamedAudio(audioId, pending, cacheStream, result.contentType).catch(() => undefined);
  return {
    audioStream: playbackStream,
    contentType: result.contentType,
    fileName: `${audioId}.${extensionFor(result.outputFormat, result.contentType)}`
  };
}

async function readPendingSpeech(cacheDir: string, audioId: string): Promise<PendingSpeech | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(cacheDir, `${audioId}.pending.json`), "utf8")) as PendingSpeech;
    const config = getKokoroConfig();
    if (
      parsed.id !== audioId ||
      typeof parsed.text !== "string" ||
      parsed.text.length === 0 ||
      parsed.text.length > 1200 ||
      !config.allowedVoices.includes(parsed.voice) ||
      !config.allowedFormats.includes(parsed.outputFormat) ||
      !Number.isFinite(parsed.speed) ||
      parsed.speed < 0.25 ||
      parsed.speed > 4 ||
      !Number.isFinite(parsed.expiresAt)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function prunePendingSpeech(cacheDir: string, now: number) {
  const files = await readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(files
    .filter((file) => file.isFile() && file.name.endsWith(".pending.json"))
    .map(async (file) => {
      const filePath = path.join(cacheDir, file.name);
      const info = await stat(filePath).catch(() => null);
      if (!info || now - info.mtimeMs > 5 * 60 * 1000) await rm(filePath, { force: true }).catch(() => undefined);
    }));
}

async function persistStreamedAudio(
  audioId: string,
  input: { voice: string; outputFormat: string; speed: number },
  stream: ReadableStream<Uint8Array>,
  contentType: string
) {
  const config = getKokoroConfig();
  const audioBuffer = Buffer.from(await new Response(stream).arrayBuffer());
  await mkdir(config.cacheDir, { recursive: true });
  const metadata: CachedAudioMetadata = {
    id: audioId,
    fileName: `${audioId}.${extensionFor(input.outputFormat, contentType)}`,
    contentType,
    outputFormat: input.outputFormat,
    voice: input.voice,
    speed: input.speed,
    createdAt: new Date().toISOString(),
    bytes: audioBuffer.byteLength
  };
  const suffix = `${process.pid}-${Date.now()}`;
  const filePath = path.join(config.cacheDir, metadata.fileName);
  const metadataPath = path.join(config.cacheDir, `${audioId}.json`);
  await writeFile(`${filePath}.${suffix}.tmp`, audioBuffer);
  await rename(`${filePath}.${suffix}.tmp`, filePath);
  await writeFile(`${metadataPath}.${suffix}.tmp`, JSON.stringify(metadata));
  await rename(`${metadataPath}.${suffix}.tmp`, metadataPath);
  void pruneAudioCache(config.cacheDir, config.cacheMaxMb * 1024 * 1024, config.cacheMaxAgeDays).catch(() => undefined);
}

async function createCachedSpeech(input: { audioId: string; text: string; voice: string; outputFormat: string; speed: number }): Promise<CachedSpeech> {
  const config = getKokoroConfig();
  await mkdir(config.cacheDir, { recursive: true });
  const result = await synthesizeSpeech(input.text, { voice: input.voice, format: input.outputFormat, speed: input.speed });
  const extension = extensionFor(result.outputFormat, result.contentType);
  const metadata: CachedAudioMetadata = {
    id: input.audioId,
    fileName: `${input.audioId}.${extension}`,
    contentType: result.contentType,
    outputFormat: result.outputFormat,
    voice: result.voice,
    speed: input.speed,
    createdAt: new Date().toISOString(),
    bytes: result.audioBuffer.byteLength
  };
  const filePath = path.join(config.cacheDir, metadata.fileName);
  const metadataPath = path.join(config.cacheDir, `${input.audioId}.json`);
  const suffix = `${process.pid}-${Date.now()}`;
  await writeFile(`${filePath}.${suffix}.tmp`, result.audioBuffer);
  await rename(`${filePath}.${suffix}.tmp`, filePath);
  await writeFile(`${metadataPath}.${suffix}.tmp`, JSON.stringify(metadata));
  await rename(`${metadataPath}.${suffix}.tmp`, metadataPath);
  void pruneAudioCache(config.cacheDir, config.cacheMaxMb * 1024 * 1024, config.cacheMaxAgeDays).catch(() => undefined);

  return {
    audioId: input.audioId,
    audioUrl: `/api/voice/${input.audioId}`,
    contentType: metadata.contentType,
    outputFormat: metadata.outputFormat,
    voice: metadata.voice,
    cached: false
  };
}

export function createAudioId(text: string, voice: string, outputFormat: string, speed = 1) {
  return createHash("sha256")
    .update(JSON.stringify({ version: 2, text: text.normalize("NFC"), voice, outputFormat, speed }))
    .digest("hex");
}

async function readMetadata(cacheDir: string, audioId: string): Promise<CachedAudioMetadata | null> {
  try {
    const raw = await readFile(path.join(cacheDir, `${audioId}.json`), "utf8");
    const parsed = JSON.parse(raw) as CachedAudioMetadata;
    return isSafeMetadata(parsed, audioId) ? parsed : null;
  } catch {
    return null;
  }
}

async function pruneAudioCache(cacheDir: string, maxBytes: number, maxAgeDays: number) {
  const files = await readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  const entries: Array<{ metadata: CachedAudioMetadata; mtimeMs: number }> = [];
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const audioId = file.name.slice(0, -5);
    const metadata = await readMetadata(cacheDir, audioId);
    if (!metadata) continue;
    const audioInfo = await stat(path.join(cacheDir, metadata.fileName)).catch(() => null);
    if (!audioInfo || now - audioInfo.mtimeMs > maxAgeMs) {
      await removeCachedFiles(cacheDir, metadata).catch(() => undefined);
      continue;
    }
    entries.push({ metadata, mtimeMs: audioInfo.mtimeMs });
  }

  let totalBytes = entries.reduce((sum, entry) => sum + entry.metadata.bytes, 0);
  for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (totalBytes <= maxBytes) break;
    await removeCachedFiles(cacheDir, entry.metadata).catch(() => undefined);
    totalBytes -= entry.metadata.bytes;
  }
}

async function removeCachedFiles(cacheDir: string, metadata: CachedAudioMetadata) {
  await Promise.all([
    rm(path.join(cacheDir, metadata.fileName), { force: true }),
    rm(path.join(cacheDir, `${metadata.id}.json`), { force: true })
  ]);
}

function extensionFor(outputFormat: string, contentType: string) {
  const fromFormat = outputFormat.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["mp3", "wav", "opus", "aac", "m4a", "ogg"].includes(fromFormat)) return fromFormat;
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  return "audio";
}

function contentTypeFor(outputFormat: string) {
  if (outputFormat === "mp3") return "audio/mpeg";
  if (outputFormat === "wav") return "audio/wav";
  if (outputFormat === "opus" || outputFormat === "ogg") return "audio/ogg";
  return `audio/${outputFormat}`;
}

export function isAudioId(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function isSafeMetadata(value: unknown, audioId: string): value is CachedAudioMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as CachedAudioMetadata;
  if (metadata.id !== audioId || typeof metadata.fileName !== "string" || typeof metadata.contentType !== "string") return false;
  return metadata.fileName.startsWith(`${audioId}.`) && !metadata.fileName.includes("/") && !metadata.fileName.includes("\\");
}
