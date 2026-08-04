import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAiConfig = vi.fn(async () => ({
  provider: "test",
  baseUrl: "https://ai.example/v1",
  apiKey: "test-key",
  chatModel: "test-model",
  modelSource: "env" as const,
  temperature: 0.4,
  maxTokens: 1200
}));
const fetcher = vi.fn();

vi.mock("../../lib/ai/config", () => ({ getAiConfig }));

const { createChatCompletion } = await import("../../lib/ai/client");

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createChatCompletion", () => {
  it("does not append an internal instruction that can leak into the model response", async () => {
    const messages = [
      { role: "system" as const, content: "Translate the sentence." },
      { role: "user" as const, content: "Let's practice." }
    ];
    fetcher
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "Vamos praticar." } }] }));

    await expect(createChatCompletion(messages, { maxTokens: 80, disableThinking: true })).resolves.toMatchObject({ content: "Vamos praticar." });

    const firstPayload = JSON.parse(fetcher.mock.calls[0][1].body as string);
    const retryPayload = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(retryPayload.messages).toEqual(messages);
    expect(retryPayload.messages).not.toContainEqual(expect.objectContaining({ content: expect.stringContaining("previous response was empty") }));
    expect(retryPayload.max_tokens).toBeGreaterThan(firstPayload.max_tokens);
  });

  it("retries an empty structured response without forcing JSON mode", async () => {
    const messages = [
      { role: "system" as const, content: "Reply with valid JSON." },
      { role: "user" as const, content: "Continue the conversation." }
    ];
    fetcher
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "   " } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"assistant_reply":"Let\'s continue."}' } }] }));

    await expect(createChatCompletion(messages, { maxTokens: 1200, responseFormat: "json", disableThinking: true })).resolves.toMatchObject({
      content: '{"assistant_reply":"Let\'s continue."}'
    });

    const fallbackPayload = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(fallbackPayload.messages).toEqual(messages);
    expect(fallbackPayload.response_format).toBeUndefined();
    expect(fallbackPayload.thinking).toEqual({ type: "disabled" });
  });
});
