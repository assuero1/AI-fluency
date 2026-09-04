import { describe, expect, it } from "vitest";
import { splitIntoSentences } from "@/lib/learning/sentences";

describe("splitIntoSentences", () => {
  it("returns empty array for empty/blank text", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   \n  ")).toEqual([]);
  });

  it("keeps a single sentence without trailing punctuation as one line", () => {
    expect(splitIntoSentences("Hello there")).toEqual(["Hello there"]);
  });

  it("splits on period, question mark and exclamation", () => {
    expect(splitIntoSentences("Hi there. How are you? Great!")).toEqual([
      "Hi there.",
      "How are you?",
      "Great!"
    ]);
  });

  it("keeps closing quotes/parens attached to the sentence", () => {
    expect(splitIntoSentences('She said "hello." Then she left.')).toEqual([
      'She said "hello."',
      "Then she left."
    ]);
  });

  it("collapses newlines and extra whitespace between sentences", () => {
    expect(splitIntoSentences("Line one.\n\n   Line two?   Line three!")).toEqual([
      "Line one.",
      "Line two?",
      "Line three!"
    ]);
  });

  it("treats ellipsis as sentence ending", () => {
    expect(splitIntoSentences("Well… I don't know. Maybe.")).toEqual([
      "Well…",
      "I don't know.",
      "Maybe."
    ]);
  });

  it("handles text with no sentence punctuation at all", () => {
    expect(splitIntoSentences("just one long fragment without stops")).toEqual([
      "just one long fragment without stops"
    ]);
  });

  it("splits Japanese and Chinese sentences with full-width punctuation", () => {
    expect(splitIntoSentences("こんにちは。お元気ですか？今日も練習しましょう。")).toEqual([
      "こんにちは。",
      "お元気ですか？",
      "今日も練習しましょう。"
    ]);
  });

  it("splits Hindi sentences with Devanagari danda", () => {
    expect(splitIntoSentences("नमस्ते। आप कैसे हैं?")).toEqual([
      "नमस्ते।",
      "आप कैसे हैं?"
    ]);
  });
});
