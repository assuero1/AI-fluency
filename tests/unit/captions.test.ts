import { describe, expect, it } from "vitest";
import {
  activeIndexAtTime,
  alignWords,
  clampWordIndex,
  hasUsableAlignment,
  segmentMessage,
  skipAlignedIndex,
  skipWordIndex,
  timedIndices,
  tokenizeForCaptions,
  wordIndexAtTime,
  type AlignedToken,
  type WordTimestamp
} from "@/lib/learning/captions";

const SIMPLE_WORDS: WordTimestamp[] = [
  { word: "Hello", start_time: 0.25, end_time: 0.55 },
  { word: "there", start_time: 0.55, end_time: 0.825 },
  { word: ".", start_time: 0.825, end_time: 0.9 },
  { word: "How", start_time: 0.9, end_time: 1.0625 },
  { word: "are", start_time: 1.0625, end_time: 1.15 },
  { word: "you", start_time: 1.15, end_time: 1.25 },
  { word: "today", start_time: 1.25, end_time: 1.775 },
  { word: "?", start_time: 1.775, end_time: 1.95 }
];

const EDGE_WORDS: WordTimestamp[] = [
  "She", "said", "\"", "hello", ".", "\"", "Well", "…", "I", "don't", "know", ".", "E-g.", ",", "it", "is", "3-to-4", "."
].map((word, index) => ({ word, start_time: index * 0.5, end_time: index * 0.5 + 0.4 }));

const EDGE_TEXT = 'She said "hello." Well… I don\'t know. E.g., it is 3-to-4.';

describe("tokenizeForCaptions", () => {
  it("splits words and punctuation", () => {
    expect(tokenizeForCaptions("Hello there.").map((token) => token.text)).toEqual(["Hello", "there", "."]);
  });

  it("keeps apostrophes and hyphens inside words", () => {
    const tokens = tokenizeForCaptions("I don't know. It is 3-to-4.");
    expect(tokens.map((token) => token.text)).toEqual(["I", "don't", "know", ".", "It", "is", "3-to-4", "."]);
    expect(tokens.every((token) => token.isWord === /[A-Za-zÀ-ÿ0-9]/.test(token.text))).toBe(true);
  });

  it("returns an empty list for blank text", () => {
    expect(tokenizeForCaptions("   \n ")).toEqual([]);
  });

  it("captures the original whitespace after each token", () => {
    const tokens = tokenizeForCaptions("¡Hola! ¿Qué tal?\nHoy  estaba...");
    expect(tokens.map((token) => [token.text, token.spaceAfter])).toEqual([
      ["¡", ""],
      ["Hola", ""],
      ["!", " "],
      ["¿", ""],
      ["Qué", " "],
      ["tal", ""],
      ["?", "\n"],
      ["Hoy", "  "],
      ["estaba", ""],
      [".", ""],
      [".", ""],
      [".", ""]
    ]);
  });
});

describe("hasUsableAlignment", () => {
  it("is false when the server returns no words (vozes sem timestamps)", () => {
    const aligned = alignWords(tokenizeForCaptions("¿Qué tal?"), []);
    expect(hasUsableAlignment(aligned)).toBe(false);
    expect(hasUsableAlignment([])).toBe(false);
  });

  it("is true when at least one token has a timestamp", () => {
    const aligned = alignWords(tokenizeForCaptions("Hello there."), SIMPLE_WORDS);
    expect(hasUsableAlignment(aligned)).toBe(true);
  });
});

describe("alignWords", () => {
  it("maps 1:1 when the server tokens match the display tokens", () => {
    const tokens = tokenizeForCaptions("Hello there. How are you today?");
    const aligned = alignWords(tokens, SIMPLE_WORDS);

    expect(aligned.length).toBe(tokens.length);
    expect(timedIndices(aligned)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(aligned[0]).toEqual({ text: "Hello", spaceAfter: " ", start: 0.25, end: 0.55 });
    expect(aligned[2]).toEqual({ text: ".", spaceAfter: " ", start: 0.825, end: 0.9 });
    expect(aligned[7]).toEqual({ text: "?", spaceAfter: "", start: 1.775, end: 1.95 });
  });

  it("merges normalized tokens like E.g. into the server word", () => {
    const tokens = tokenizeForCaptions(EDGE_TEXT);
    const aligned = alignWords(tokens, EDGE_WORDS);

    expect(tokens.length).toBe(21);
    expect(aligned.length).toBe(21);
    expect(aligned.map((token) => token.text)).toEqual(tokens.map((token) => token.text));

    // "E", ".", "g" viram o token normalizado "E-g." do servidor (mesmo intervalo).
    expect(aligned[12].start).toBe(EDGE_WORDS[12].start_time);
    expect(aligned[13].start).toBe(EDGE_WORDS[12].start_time);
    expect(aligned[14].start).toBe(EDGE_WORDS[12].start_time);
    // "don't" casa 1:1 com o token do servidor.
    expect(aligned[9].start).toBe(EDGE_WORDS[9].start_time);
    // A pontuação excedente após "g" se junta ao grupo da palavra seguinte ("it").
    expect(aligned[15].start).toBe(EDGE_WORDS[14].start_time);
    expect(aligned[16].start).toBe(EDGE_WORDS[14].start_time);
    expect(aligned[17].start).toBe(EDGE_WORDS[14].start_time);
    // Última palavra/pontuação preservadas.
    expect(aligned[19].start).toBe(EDGE_WORDS[16].start_time);
    expect(aligned[20].start).toBe(EDGE_WORDS[17].start_time);
  });

  it("leaves every token without timestamps when the server returns no words", () => {
    const tokens = tokenizeForCaptions("Hello there.");
    const aligned = alignWords(tokens, []);
    expect(aligned).toEqual([
      { text: "Hello", spaceAfter: " " },
      { text: "there", spaceAfter: "" },
      { text: ".", spaceAfter: "" }
    ]);
    expect(timedIndices(aligned)).toEqual([]);
  });
});

describe("wordIndexAtTime", () => {
  it("resolves the active word with start inclusive and end exclusive", () => {
    expect(wordIndexAtTime(SIMPLE_WORDS, 0.1)).toBe(0);
    expect(wordIndexAtTime(SIMPLE_WORDS, 0.25)).toBe(0);
    expect(wordIndexAtTime(SIMPLE_WORDS, 0.5)).toBe(0);
    expect(wordIndexAtTime(SIMPLE_WORDS, 0.55)).toBe(1);
    expect(wordIndexAtTime(SIMPLE_WORDS, 0.825)).toBe(2);
    expect(wordIndexAtTime(SIMPLE_WORDS, 1.15)).toBe(5);
    expect(wordIndexAtTime(SIMPLE_WORDS, 3)).toBe(7);
  });

  it("keeps the previous word during inter-word silence", () => {
    const gapped = [
      { word: "a", start_time: 0, end_time: 0.5 },
      { word: "b", start_time: 1, end_time: 1.5 }
    ];
    expect(wordIndexAtTime(gapped, 0.7)).toBe(0);
  });

  it("returns -1 for an empty track", () => {
    expect(wordIndexAtTime([], 1)).toBe(-1);
  });
});

describe("clampWordIndex and skipWordIndex", () => {
  it("clamps to the track bounds", () => {
    expect(clampWordIndex(SIMPLE_WORDS, -3)).toBe(0);
    expect(clampWordIndex(SIMPLE_WORDS, 99)).toBe(7);
    expect(clampWordIndex([], 2)).toBe(-1);
  });

  it("skips in steps of five words", () => {
    expect(skipWordIndex(SIMPLE_WORDS, 0, 1)).toBe(5);
    expect(skipWordIndex(SIMPLE_WORDS, 2, -1)).toBe(0);
    expect(skipWordIndex(SIMPLE_WORDS, 6, 1)).toBe(7);
    expect(skipWordIndex(SIMPLE_WORDS, -1, 1)).toBe(5);
  });
});

describe("activeIndexAtTime and skipAlignedIndex", () => {
  const aligned: AlignedToken[] = alignWords(tokenizeForCaptions("Hello there. How are you today?"), SIMPLE_WORDS);

  it("maps a playback time to the highlighted display token", () => {
    expect(activeIndexAtTime(aligned, 0.1)).toBe(0);
    expect(activeIndexAtTime(aligned, 0.5)).toBe(0);
    expect(activeIndexAtTime(aligned, 0.6)).toBe(1);
    expect(activeIndexAtTime(aligned, 3)).toBe(7);
    expect(activeIndexAtTime([], 0.5)).toBe(-1);
  });

  it("skips five timestamped display tokens", () => {
    expect(skipAlignedIndex(aligned, 0, 1)).toBe(5);
    expect(skipAlignedIndex(aligned, 3, -1)).toBe(0);
    expect(skipAlignedIndex(aligned, 5, 1)).toBe(7);
    expect(skipAlignedIndex([], 0, 1)).toBe(-1);
  });
});

describe("segmentMessage", () => {
  it("joins short sentences up to the length limit", () => {
    expect(segmentMessage("One. Two. Three.", 12)).toEqual(["One. Two.", "Three."]);
    expect(segmentMessage("One. Two. Three.", 20)).toEqual(["One. Two. Three."]);
  });

  it("keeps an oversized fragment as its own segment without cutting words", () => {
    const fragment = "a".repeat(2000);
    expect(segmentMessage(`Short. ${fragment}`, 1200)).toEqual(["Short.", fragment]);
  });

  it("returns an empty list for blank text", () => {
    expect(segmentMessage("   ")).toEqual([]);
  });
});
