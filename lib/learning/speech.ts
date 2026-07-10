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
      if (/[.!?…]$/.test(segment)) return segment;
      return index < cleanSegments.length - 1 ? `${segment},` : segment;
    })
    .join(" ");

  return punctuateSpeechSentence(joined, languageCode);
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
