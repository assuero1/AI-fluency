export const speechLocales: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT"
};

const speechLanguageNames: Record<string, string> = {
  en: "inglês (Estados Unidos)",
  es: "espanhol (Espanha)",
  fr: "francês (França)",
  it: "italiano (Itália)"
};

export function speechLocale(languageCode: string | undefined) {
  return speechLocales[languageCode?.toLowerCase() ?? ""] ?? "en-US";
}

export function speechLanguageName(languageCode: string | undefined) {
  return speechLanguageNames[languageCode?.toLowerCase() ?? ""] ?? "inglês (Estados Unidos)";
}

export function speechRecognitionErrorMessage(error: string | undefined) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Permissão do microfone negada. Você ainda pode digitar normalmente.";
  }
  if (error === "no-speech") return "Nenhuma fala foi detectada. Tente novamente ou digite sua mensagem.";
  if (error === "audio-capture") return "Nenhum microfone disponível. Você ainda pode digitar normalmente.";
  if (error === "network") return "O reconhecimento de voz perdeu a conexão. Tente novamente ou digite sua mensagem.";
  if (error === "aborted") return null;
  return "Não foi possível transcrever sua fala. Tente novamente ou use a digitação.";
}

export function joinSpeechSegments(segments: string[], languageCode: string | undefined) {
  const cleanSegments = segments.map((segment) => normalizeSpeechSpacing(segment)).filter(Boolean);
  if (cleanSegments.length === 0) return "";

  const joined = cleanSegments
    .map((segment, index) => {
      if (index === 0) return segment;
      const previous = cleanSegments[index - 1];
      if (/[.!?…]$/.test(previous)) return segment;
      return lowercaseFirstLetter(segment);
    })
    .join(" ");

  return punctuateSpeechSentence(joined, languageCode);
}

function lowercaseFirstLetter(value: string) {
  const first = value[0];
  if (!first) return value;
  const lowered = first.toLocaleLowerCase();
  return first === lowered ? value : `${lowered}${value.slice(1)}`;
}

export function punctuateSpeechSentence(value: string, languageCode: string | undefined) {
  const clean = normalizeSpeechSpacing(value);
  if (!clean || /[.!?…]$/.test(clean)) return clean;
  return `${clean}${looksLikeQuestion(clean, languageCode) ? "?" : "."}`;
}

function normalizeSpeechSpacing(value: string) {
  return value.trim().replace(/\s+([,.;!?])/g, "$1").replace(/\s+/g, " ");
}

function looksLikeQuestion(value: string, languageCode: string | undefined) {
  const normalized = value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[¿¡]\s*/, "");
  const starters: Record<string, RegExp> = {
    en: /^(who|what|where|when|why|how|which|do|does|did|can|could|would|will|is|are|was|were|have|has)\b/,
    es: /^(quien|que|donde|cuando|por que|como|cual|cuanto|puedes|podrias|quieres|es|son|tienes|has)\b/,
    fr: /^(qui|que|quoi|ou|quand|pourquoi|comment|quel|quelle|combien|est-ce|peux|pourrais|veux|as-tu)\b/,
    it: /^(chi|che|cosa|dove|quando|perche|come|quale|quanto|puoi|potresti|vuoi|hai|sei)\b/
  };
  return (starters[languageCode?.toLowerCase() ?? ""] ?? starters.en).test(normalized);
}

const AUDIO_ROUTE_RESTORE_MS = 350;

let micReleasedAt = 0;
let routeNudgeAudio: HTMLAudioElement | null = null;

/**
 * Marca a liberação do microfone e "acorda" a rota de playback: toca um WAV
 * silencioso ainda no rastro do gesto do usuário (parar o ditado), forçando a
 * AVAudioSession do iOS a sair do modo gravação (auricular) e voltar ao
 * alto-falante antes do próximo TTS. Sem o nudge, a restauração dependia só do
 * wait fixo de `AUDIO_ROUTE_RESTORE_MS` — e às vezes o áudio saía no auricular.
 */
export function releaseMicForPlayback() {
  micReleasedAt = Date.now();
  nudgePlaybackRoute();
}

export function msUntilAudioRouteRestored(now = Date.now()) {
  return Math.max(0, AUDIO_ROUTE_RESTORE_MS - (now - micReleasedAt));
}

/** WAV silencioso (~50ms, PCM 8-bit mono 8kHz) como data URI, montado uma vez. */
let cachedSilentWavUri: string | null = null;

export function silentWavUri() {
  if (cachedSilentWavUri) return cachedSilentWavUri;
  const sampleRate = 8000;
  const sampleCount = 400;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits por amostra
  writeAscii(36, "data");
  view.setUint32(40, sampleCount, true);
  bytes.fill(0x80, 44); // silêncio em PCM 8-bit
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  cachedSilentWavUri = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedSilentWavUri;
}

function nudgePlaybackRoute() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  try {
    routeNudgeAudio ??= new Audio();
    routeNudgeAudio.src = silentWavUri();
    routeNudgeAudio.volume = 0;
    void routeNudgeAudio.play().catch(() => undefined);
  } catch {
    // O nudge é best-effort; o wait de AUDIO_ROUTE_RESTORE_MS continua valendo.
  }
}
