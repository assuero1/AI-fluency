export const DEFAULT_KOKORO_VOICES = {
  en: "af_heart",
  es: "ef_dora",
  fr: "ff_siwis",
  it: "if_sara",
  pt: "pf_dora"
} as const;

export type KokoroVoiceMap = Record<string, string>;

export function normalizeSpeechLanguage(languageCode: string | undefined) {
  return languageCode?.trim().toLowerCase().split(/[-_]/)[0] || "en";
}

export function selectKokoroVoice(languageCode: string | undefined, voices: KokoroVoiceMap, fallbackVoice: string) {
  return voices[normalizeSpeechLanguage(languageCode)] ?? fallbackVoice;
}
