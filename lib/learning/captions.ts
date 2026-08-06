import { splitIntoSentences } from "@/lib/learning/sentences";

export const MAX_CAPTIONED_SEGMENT_LENGTH = 1200;

export type WordTimestamp = {
  word: string;
  start_time: number;
  end_time: number;
};

export type CaptionToken = {
  text: string;
  isWord: boolean;
};

export type AlignedToken = {
  text: string;
  start?: number;
  end?: number;
};

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’\-–][\p{L}\p{N}]+)*|[^\p{L}\p{N}\s]/gu;

/**
 * Tokeniza o texto de exibição como o servidor Kokoro agrupa as palavras:
 * apóstrofos e hífens internos ficam dentro do token ("don't", "3-to-4") e a
 * pontuação vira um token separado.
 */
export function tokenizeForCaptions(text: string): CaptionToken[] {
  const matches = text.match(TOKEN_RE) ?? [];
  return matches.map((token) => ({
    text: token,
    isWord: /[\p{L}\p{N}]/u.test(token)
  }));
}

/** Forma normalizada para comparação de tokens (só letras/números, minúsculas). */
function normalizeForMatch(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Alinha os tokens de exibição com a lista de palavras com timestamp do
 * servidor. No caso comum é 1:1; quando a normalização do servidor agrupa ou
 * reescreve tokens (ex.: "E.g." → "E-g."), faz um merge guloso com lookahead.
 * Tokens sem par ficam sem timestamp e não quebram o fluxo do player.
 */
export function alignWords(tokens: CaptionToken[], words: WordTimestamp[]): AlignedToken[] {
  const aligned: AlignedToken[] = tokens.map((token) => ({ text: token.text }));
  const maxGroup = 4;
  let wordIndex = 0;
  let tokenIndex = 0;

  while (wordIndex < words.length && tokenIndex < tokens.length) {
    const target = normalizeForMatch(words[wordIndex].word);
    let groupLength = -1;
    if (target === "") {
      // Palavra só de pontuação: casa apenas por igualdade exata (evita que
      // "," case com qualquer pontuação vizinha após normalização vazia).
      if (tokens[tokenIndex]?.text === words[wordIndex].word) groupLength = 0;
    } else {
      for (let size = 0; size < maxGroup && tokenIndex + size < tokens.length; size++) {
        const group = tokens
          .slice(tokenIndex, tokenIndex + size + 1)
          .map((token) => token.text)
          .join("");
        if (normalizeForMatch(group) === target) {
          groupLength = size;
          break;
        }
      }
    }
    if (groupLength === -1) {
      wordIndex += 1;
      continue;
    }
    for (let offset = 0; offset <= groupLength; offset++) {
      aligned[tokenIndex + offset].start = words[wordIndex].start_time;
      aligned[tokenIndex + offset].end = words[wordIndex].end_time;
    }
    tokenIndex += groupLength + 1;
    wordIndex += 1;
  }

  return aligned;
}

/** Índices (na lista exibida) dos tokens que têm timestamp, em ordem. */
export function timedIndices(aligned: AlignedToken[]): number[] {
  const indices: number[] = [];
  aligned.forEach((token, index) => {
    if (typeof token.start === "number" && typeof token.end === "number") indices.push(index);
  });
  return indices;
}

/** Índice da palavra ativa para um tempo de reprodução (start incluso, end exclusivo). */
export function wordIndexAtTime(words: WordTimestamp[], time: number): number {
  if (words.length === 0) return -1;
  if (time <= words[0].start_time) return 0;
  const last = words.length - 1;
  if (time >= words[last].end_time) return last;

  let low = 0;
  let high = last;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (time < words[mid].start_time) high = mid - 1;
    else if (time >= words[mid].end_time) low = mid + 1;
    else return mid;
  }
  return high;
}

export function clampWordIndex(words: WordTimestamp[], index: number): number {
  if (words.length === 0) return -1;
  return Math.min(Math.max(index, 0), words.length - 1);
}

/** Pula de step em step (padrão 5) sobre a lista de palavras do servidor. */
export function skipWordIndex(words: WordTimestamp[], index: number, delta: number, step = 5): number {
  if (words.length === 0) return -1;
  const current = index < 0 ? 0 : Math.min(index, words.length - 1);
  return clampWordIndex(words, current + delta * step);
}

/** Índice do token de exibição a destacar para um tempo de reprodução. */
export function activeIndexAtTime(aligned: AlignedToken[], time: number): number {
  const timed = timedIndices(aligned);
  if (timed.length === 0) return -1;
  const first = timed[0];
  const last = timed[timed.length - 1];
  const firstStart = aligned[first].start as number;
  const lastEnd = aligned[last].end as number;
  if (time <= firstStart) return first;
  if (time >= lastEnd) return last;

  let low = 0;
  let high = timed.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const index = timed[mid];
    const start = aligned[index].start as number;
    const end = aligned[index].end as number;
    if (time < start) high = mid - 1;
    else if (time >= end) low = mid + 1;
    else return index;
  }
  return timed[high];
}

/** Pula de step em step (padrão 5) sobre os tokens de exibição com timestamp. */
export function skipAlignedIndex(aligned: AlignedToken[], fromIndex: number, delta: number, step = 5): number {
  const timed = timedIndices(aligned);
  if (timed.length === 0) return -1;
  let position = timed.indexOf(fromIndex);
  if (position === -1) {
    position = timed.findIndex((index) => index >= fromIndex);
    if (position === -1) position = timed.length - 1;
  }
  const target = Math.min(Math.max(position + delta * step, 0), timed.length - 1);
  return timed[target];
}

/**
 * Agrupa frases em segmentos de até maxLength caracteres. Uma frase sem
 * pontuação mais longa que o limite vira um segmento próprio (nunca corta no
 * meio de uma palavra).
 */
export function segmentMessage(text: string, maxLength = MAX_CAPTIONED_SEGMENT_LENGTH): string[] {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return [];

  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push(sentence);
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      segments.push(current);
      current = sentence;
    }
  }
  if (current) segments.push(current);
  return segments;
}
