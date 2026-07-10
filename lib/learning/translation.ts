import "server-only";

import { createChatCompletion } from "@/lib/ai/client";

export const MAX_TRANSLATION_TEXT_LENGTH = 1200;

type TranslationCacheEntry = {
  expiresAt: number;
  translation: string;
};

const translationCache = new Map<string, TranslationCacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 400;

export class TranslationValidationError extends Error {
  status = 400;
}

export async function translateToPortuguese(text: string, sourceLanguage: string) {
  const cleanText = text.trim();
  if (!cleanText) throw new TranslationValidationError("Informe uma frase para traduzir.");
  if (cleanText.length > MAX_TRANSLATION_TEXT_LENGTH) {
    throw new TranslationValidationError("A frase é longa demais para tradução.");
  }

  const source = sourceLanguage.trim().toLowerCase().slice(0, 16) || "auto";
  const cacheKey = `${source}\n${cleanText.normalize("NFC")}`;
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    translationCache.delete(cacheKey);
    translationCache.set(cacheKey, cached);
    return { translation: cached.translation, cached: true };
  }
  if (cached) translationCache.delete(cacheKey);

  const result = await createChatCompletion(
    [
      {
        role: "system",
        content: [
          "Você é um tradutor para um app de aprendizado de idiomas.",
          "Traduza fielmente a frase para português brasileiro natural.",
          "Preserve nomes, intenção, tom e pontuação.",
          "Responda somente com a tradução, sem aspas, explicações ou markdown."
        ].join("\n")
      },
      {
        role: "user",
        content: `Idioma de origem: ${source}\nFrase: ${cleanText}`
      }
    ],
    { temperature: 0, maxTokens: Math.min(420, Math.max(80, Math.ceil(cleanText.length * 1.2))) }
  );
  const translation = result.content.trim().replace(/^(["“])|(["”])$/g, "");
  if (!translation) throw new Error("A IA não retornou uma tradução.");

  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, translation });
  return { translation, cached: false };
}
