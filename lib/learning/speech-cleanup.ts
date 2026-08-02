import "server-only";
import { createChatCompletion } from "@/lib/ai/client";

const cleanupLanguageNames: Record<string, string> = {
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  it: "italiano"
};

export async function cleanupSpeechTranscript(rawText: string, languageCode: string | undefined): Promise<string> {
  const raw = rawText.trim();
  if (!raw) return "";

  const ai = await createChatCompletion([
    {
      role: "system",
      content: [
        "Você corrige pontuação e capitalização de texto produzido por reconhecimento de voz.",
        "Regras obrigatórias:",
        "- NÃO adicione, remova, substitua ou reordene palavras.",
        "- Pausas na fala NÃO são vírgulas: remova vírgulas sem função gramatical.",
        "- Corrija letras maiúsculas indevidas no meio de frases e preserve/restore maiúsculas de nomes próprios.",
        "- Divida o texto em frases terminadas com . ! ou ? quando o sentido indicar.",
        "- Retorne SOMENTE o texto corrigido, sem comentários nem aspas."
      ].join("\n")
    },
    {
      role: "user",
      content: `Idioma do texto: ${cleanupLanguageNames[languageCode?.toLowerCase() ?? ""] ?? "inglês"}\nTexto ditado:\n${raw}`
    }
  ], { temperature: 0, maxTokens: Math.max(120, raw.length * 2), timeoutMs: 3000, disableThinking: true });

  const cleaned = ai.content.trim();
  if (!cleaned || divergesFromRaw(raw, cleaned)) return raw;
  return cleaned;
}

export function divergesFromRaw(raw: string, cleaned: string) {
  const rawWords = wordList(raw);
  const cleanedWords = wordList(cleaned);
  if (Math.abs(rawWords.length - cleanedWords.length) > 1) return true;
  const comparable = Math.min(rawWords.length, cleanedWords.length);
  const matches = rawWords.slice(0, comparable).filter((word, index) => word === cleanedWords[index]).length;
  return matches < comparable * 0.8;
}

function wordList(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
