import { jsonOk } from "@/lib/api/responses";
import { cleanupSpeechTranscript } from "@/lib/learning/speech-cleanup";

const MAX_TRANSCRIPT_LENGTH = 2000;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { text?: string; language?: string };
    const raw = (body.text ?? "").trim();
    if (!raw || raw.length > MAX_TRANSCRIPT_LENGTH) {
      return jsonOk({ ok: true, text: raw, cleaned: false });
    }
    const cleaned = await cleanupSpeechTranscript(raw, body.language);
    return jsonOk({ ok: true, text: cleaned, cleaned: cleaned !== raw });
  } catch {
    // Cleanup é best-effort: em qualquer falha (JSON inválido ou IA) o cliente fica com o texto bruto.
    return jsonOk({ ok: true, text: "", cleaned: false });
  }
}
