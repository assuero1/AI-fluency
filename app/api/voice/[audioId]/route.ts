import { jsonError } from "@/lib/api/responses";
import { readCachedAudio, streamPendingAudio } from "@/lib/kokoro/cache";

export async function GET(_request: Request, context: { params: Promise<{ audioId: string }> }) {
  const { audioId } = await context.params;
  const result = await readCachedAudio(audioId);
  if (result) {
    return new Response(result.audio, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.audio.byteLength),
        "Content-Disposition": `inline; filename="${result.fileName}"`,
        "Cache-Control": "private, max-age=604800"
      }
    });
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
}
