/**
 * Splits message text into speakable sentence lines for the
 * line-synced audio player in the chat.
 *
 * Known limitation (accepted): abbreviations with a period
 * ("Dr.", "etc.") may split into extra lines.
 */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g);
  return (sentences ?? [normalized]).map((sentence) => sentence.trim()).filter(Boolean);
}
