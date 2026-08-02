import { beforeEach, describe, expect, it, vi } from "vitest";

const createChatCompletion = vi.fn();
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

const { cleanupSpeechTranscript, divergesFromRaw } = await import("../../lib/learning/speech-cleanup");

beforeEach(() => {
  createChatCompletion.mockReset();
});

describe("cleanupSpeechTranscript", () => {
  it("returns the corrected text when the LLM only fixes punctuation and case", async () => {
    createChatCompletion.mockResolvedValue({ content: "I went to the market then I met Ana." });
    await expect(cleanupSpeechTranscript("I went to the market, Then I met Ana.", "en")).resolves.toBe(
      "I went to the market then I met Ana."
    );
  });

  it("returns the raw text when the LLM rewrites the sentence", async () => {
    createChatCompletion.mockResolvedValue({ content: "Yesterday I went shopping at the market and saw Ana." });
    const raw = "I went to the market, Then I met Ana.";
    await expect(cleanupSpeechTranscript(raw, "en")).resolves.toBe(raw);
  });

  it("returns the raw text when the LLM drops or adds words", async () => {
    createChatCompletion.mockResolvedValue({ content: "I went to the market." });
    const raw = "I went to the market, Then I met Ana.";
    await expect(cleanupSpeechTranscript(raw, "en")).resolves.toBe(raw);
  });

  it("returns the raw text unchanged when it is empty", async () => {
    await expect(cleanupSpeechTranscript("   ", "en")).resolves.toBe("");
    expect(createChatCompletion).not.toHaveBeenCalled();
  });
});

describe("divergesFromRaw", () => {
  it("ignores case, accents and punctuation when comparing", () => {
    expect(divergesFromRaw("Voce foi, Para a praia", "Você foi para a praia.")).toBe(false);
  });

  it("flags word changes as divergence", () => {
    expect(divergesFromRaw("I like dogs", "I like cats")).toBe(true);
  });
});
