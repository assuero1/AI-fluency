import { beforeEach, describe, expect, it, vi } from "vitest";

const createChatCompletion = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));

const { translateToPortuguese } = await import("../../lib/learning/translation");

beforeEach(() => {
  createChatCompletion.mockReset();
});

describe("translateToPortuguese", () => {
  it("disables model reasoning and reserves enough output for a concise translation", async () => {
    createChatCompletion.mockResolvedValue({ content: "Vamos praticar.", tokensUsed: 4 });

    await expect(translateToPortuguese("Let's practice.", "en")).resolves.toMatchObject({ translation: "Vamos praticar." });

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    const options = createChatCompletion.mock.calls[0][1];
    expect(options).toMatchObject({ temperature: 0, disableThinking: true });
    expect(options.maxTokens).toBeGreaterThanOrEqual(120);
  });
});
