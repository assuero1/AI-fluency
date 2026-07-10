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
