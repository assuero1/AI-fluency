/**
 * Splits message text into speakable sentence lines for the
 * line-synced audio player in the chat.
 *
 * Protects common abbreviations, initials, and decimal numbers from
 * being incorrectly split, and splits overly long sentences at natural
 * clause boundaries to ensure responsive Kokoro synthesis.
 */

const ABBREVIATIONS = /\b(?:mr|mrs|ms|dr|prof|sr|sra|srta|dra|rev|gen|col|capt|lt|sgt|dept|univ|est|approx|appr|apt|min|sec|hr|no|vol|vs|etc|e\.g|i\.e)\./gi;
const INITIALS = /\b[A-Z]\./g;
const DECIMALS = /\d+\.\d+/g;
const PLACEHOLDER = "\uE000";
export const MAX_SENTENCE_SPLIT_LENGTH = 180;

function protectTokens(text: string): string {
  return text
    .replace(DECIMALS, (match) => match.replace(/\./g, PLACEHOLDER))
    .replace(ABBREVIATIONS, (match) => match.replace(/\./g, PLACEHOLDER))
    .replace(INITIALS, (match) => match.replace(/\./g, PLACEHOLDER));
}

function unprotectTokens(text: string): string {
  return text.replaceAll(PLACEHOLDER, ".");
}

function splitLongSentence(sentence: string, maxLength = MAX_SENTENCE_SPLIT_LENGTH): string[] {
  if (sentence.length <= maxLength) return [sentence];

  // Try splitting by natural clause delimiters
  for (const delimiter of ["; ", ": ", " — ", " – ", ", "]) {
    if (sentence.includes(delimiter)) {
      const parts = sentence.split(delimiter);
      const chunks: string[] = [];
      let current = "";

      for (let i = 0; i < parts.length; i++) {
        const item = parts[i].trim();
        if (!item) continue;
        const clause = i < parts.length - 1 ? item + delimiter.trimEnd() : item;

        if (!current) {
          current = clause;
        } else if (current.length + clause.length + 1 <= maxLength) {
          current += " " + clause;
        } else {
          chunks.push(current.trim());
          current = clause;
        }
      }
      if (current) chunks.push(current.trim());
      if (chunks.length > 1) return chunks;
    }
  }

  // If no delimiter was found or couldn't split, split at word boundaries
  const words = sentence.split(" ");
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= maxLength) {
      current += " " + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [sentence];
}

export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const protectedText = protectTokens(normalized);
  const rawMatches = protectedText.match(/[^.!?…~。！？।]+[.!?…~。！？।]+["'”’)\]」』]*|[^.!?…~。！？।]+$/g);
  const rawSentences = (rawMatches ?? [protectedText])
    .map((s) => unprotectTokens(s).trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const sentence of rawSentences) {
    if (sentence.length > MAX_SENTENCE_SPLIT_LENGTH) {
      result.push(...splitLongSentence(sentence, MAX_SENTENCE_SPLIT_LENGTH));
    } else {
      result.push(sentence);
    }
  }

  return result;
}
