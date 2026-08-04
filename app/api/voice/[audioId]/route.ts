import { jsonError } from "@/lib/api/responses";
import { parseByteRangeHeader } from "@/lib/kokoro/audio-range";
import { readCachedAudio, streamPendingAudio } from "@/lib/kokoro/cache";

export async function GET(request: Request, context: { params: Promise<{ audioId: string }> }) {
  try {
    const { audioId } = await context.params;
    const result = await readCachedAudio(audioId);
    if (result) {
      return cachedAudioResponse(request, result);
    }

    const pending = await streamPendingAudio(audioId);
    if (!pending) {
      const response = jsonError("Áudio não encontrado ou expirado.", 404);
      response.headers.set("Cache-Control", "no-store, max-age=0");
      return response;
    }

    return new Response(pending.audioStream, {
      headers: {
        "Content-Type": pending.contentType,
        "Content-Disposition": `inline; filename="${pending.fileName}"`,
        "Cache-Control": "private, no-store, max-age=0"
      }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "voice_audio_failed", message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
    const response = jsonError("Não foi possível gerar o áudio agora.", 502);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  }
}

function cachedAudioResponse(request: Request, result: { audio: Buffer; contentType: string; fileName: string }) {
  const range = parseByteRangeHeader(request.headers.get("range"), result.audio.byteLength);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": result.contentType,
    "Content-Disposition": `inline; filename="${result.fileName}"`,
    "Cache-Control": "private, max-age=604800"
  };

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${result.audio.byteLength}` }
    });
  }

  if (!range) {
    return new Response(new Uint8Array(result.audio), {
      headers: { ...commonHeaders, "Content-Length": String(result.audio.byteLength) }
    });
  }

  const body = new Uint8Array(result.audio.subarray(range.start, range.end + 1));
  return new Response(body, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(body.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${result.audio.byteLength}`
    }
  });
}
