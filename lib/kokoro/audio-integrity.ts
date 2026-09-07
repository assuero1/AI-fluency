import "server-only";

const ID3_HEADER_BYTES = 10;
const OGG_FIXED_HEADER_BYTES = 27;

export type NormalizedAudio = {
  audio: Buffer;
  contentType: string;
};

/**
 * Corrige os contêineres que o Kokoro pode devolver concatenados.
 *
 * - Ogg/Opus: a VPS acrescenta versões progressivas da mesma fala como fluxos
 *   lógicos completos. A última versão é a completa; as anteriores fazem o
 *   navegador repetir a frase.
 * - MP3: a VPS concatena partes diferentes, cada uma com seu próprio ID3. As
 *   tags internas quebram alguns decodificadores, então só elas são removidas.
 */
export function normalizeKokoroAudio(
  audio: Buffer,
  contentType: string,
  outputFormat: string
): NormalizedAudio {
  const format = outputFormat.toLowerCase();
  const type = contentType.toLowerCase();

  if (isOggOpus(audio, type, format)) {
    return {
      audio: keepLastOggOpusStream(audio),
      // A resposta `audio/opus` da VPS contém um contêiner Ogg, cujo MIME
      // correto e mais interoperável (inclusive no Safari) é audio/ogg.
      contentType: "audio/ogg"
    };
  }

  if (format === "mp3" || type.includes("mpeg") || type.includes("mp3")) {
    return { audio: stripEmbeddedId3Tags(audio), contentType };
  }

  return { audio, contentType };
}

export function needsBufferedKokoroNormalization(contentType: string, outputFormat: string) {
  const format = outputFormat.toLowerCase();
  const type = contentType.toLowerCase();
  return format === "opus" || format === "ogg" || type.includes("opus") || type.includes("ogg");
}

function isOggOpus(audio: Buffer, contentType: string, outputFormat: string) {
  const declaredOpus = outputFormat === "opus" || outputFormat === "ogg" || contentType.includes("opus") || contentType.includes("ogg");
  return declaredOpus && audio.byteLength >= OGG_FIXED_HEADER_BYTES && audio.toString("ascii", 0, 4) === "OggS";
}

function keepLastOggOpusStream(audio: Buffer): Buffer {
  const streamStarts: number[] = [];
  let offset = 0;

  while (offset < audio.byteLength) {
    if (offset + OGG_FIXED_HEADER_BYTES > audio.byteLength || audio.toString("ascii", offset, offset + 4) !== "OggS") return audio;
    const segmentCount = audio[offset + 26];
    const segmentTableEnd = offset + OGG_FIXED_HEADER_BYTES + segmentCount;
    if (segmentTableEnd > audio.byteLength) return audio;

    let payloadBytes = 0;
    for (let index = offset + OGG_FIXED_HEADER_BYTES; index < segmentTableEnd; index += 1) payloadBytes += audio[index];
    const pageEnd = segmentTableEnd + payloadBytes;
    if (pageEnd > audio.byteLength) return audio;

    const isBeginningOfStream = (audio[offset + 5] & 0x02) !== 0;
    const beginsWithOpusHead =
      pageEnd - segmentTableEnd >= 8 &&
      audio.toString("ascii", segmentTableEnd, segmentTableEnd + 8) === "OpusHead";
    if (isBeginningOfStream && beginsWithOpusHead) streamStarts.push(offset);
    offset = pageEnd;
  }

  if (offset !== audio.byteLength || streamStarts.length < 2) return audio;
  return audio.subarray(streamStarts.at(-1)!);
}

function stripEmbeddedId3Tags(audio: Buffer): Buffer {
  if (audio.byteLength < ID3_HEADER_BYTES * 2) return audio;
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 1;

  while (searchFrom <= audio.byteLength - ID3_HEADER_BYTES) {
    const start = audio.indexOf("ID3", searchFrom, "ascii");
    if (start < 0) break;
    const end = id3TagEnd(audio, start);
    if (end !== null) {
      ranges.push({ start, end });
      searchFrom = end;
    } else {
      searchFrom = start + 1;
    }
  }

  if (!ranges.length) return audio;
  const chunks: Buffer[] = [];
  let cursor = 0;
  for (const range of ranges) {
    chunks.push(audio.subarray(cursor, range.start));
    cursor = range.end;
  }
  chunks.push(audio.subarray(cursor));
  return Buffer.concat(chunks);
}

function id3TagEnd(audio: Buffer, start: number): number | null {
  if (start + ID3_HEADER_BYTES > audio.byteLength) return null;
  const majorVersion = audio[start + 3];
  const revision = audio[start + 4];
  const flags = audio[start + 5];
  const sizeBytes = [audio[start + 6], audio[start + 7], audio[start + 8], audio[start + 9]];
  if (majorVersion < 2 || majorVersion > 4 || revision === 0xff || sizeBytes.some((byte) => byte >= 0x80)) return null;

  const payloadBytes = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
  const footerBytes = majorVersion === 4 && (flags & 0x10) !== 0 ? ID3_HEADER_BYTES : 0;
  const end = start + ID3_HEADER_BYTES + payloadBytes + footerBytes;
  return end <= audio.byteLength ? end : null;
}
