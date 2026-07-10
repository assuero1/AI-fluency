import { getAiConfig } from "./config";

export class AiConfigError extends Error {
  status = 503;
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    text?: string;
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
};

export async function createChatCompletion(messages: AiMessage[], options?: { temperature?: number; maxTokens?: number }) {
  const config = getAiConfig();

  if (!config.baseUrl) throw new AiConfigError("AI_BASE_URL is not configured.");
  if (!config.apiKey) throw new AiConfigError("AI_API_KEY is not configured.");
  if (!config.chatModel) throw new AiConfigError("AI_CHAT_MODEL is not configured.");

  const payload = {
    model: config.chatModel,
    messages,
    temperature: options?.temperature ?? config.temperature,
    max_tokens: options?.maxTokens ?? config.maxTokens
  };

  const body = await requestChatCompletion(config.baseUrl, config.apiKey, payload);
  const content = extractCompletionContent(body);

  if (!content) {
    const retryBody = await requestChatCompletion(config.baseUrl, config.apiKey, {
      ...payload,
      temperature: 0.2,
      max_tokens: Math.max(options?.maxTokens ?? config.maxTokens, 600),
      messages: [
        ...messages,
        {
          role: "user",
          content: "Your previous response was empty. Reply now with the requested content only."
        }
      ]
    });
    const retryContent = extractCompletionContent(retryBody);
    if (!retryContent) throw new AiRequestError("AI provider returned an empty response.", 502, retryBody);

    return {
      content: retryContent,
      model: config.chatModel,
      provider: config.provider,
      tokensUsed: retryBody.usage?.total_tokens ?? 0
    };
  }

  return {
    content,
    model: config.chatModel,
    provider: config.provider,
    tokensUsed: body.usage?.total_tokens ?? 0
  };
}

async function requestChatCompletion(
  baseUrl: string,
  apiKey: string,
  payload: {
    model: string;
    messages: AiMessage[];
    temperature: number;
    max_tokens: number;
  }
) {
  const response = await fetch(`${trimSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    throw new AiRequestError(`AI provider request failed: ${response.status}`, response.status, body);
  }

  return body as ChatCompletionResponse;
}

function extractCompletionContent(result: ChatCompletionResponse) {
  const choice = result.choices?.[0];
  return (choice?.message?.content ?? choice?.text ?? choice?.delta?.content ?? "").trim();
}

export async function testAiConnection() {
  const config = getAiConfig();

  if (!config.baseUrl) throw new AiConfigError("AI_BASE_URL is not configured.");
  if (!config.apiKey) throw new AiConfigError("AI_API_KEY is not configured.");
  if (!config.chatModel) throw new AiConfigError("AI_CHAT_MODEL is not configured.");

  const response = await fetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.chatModel,
      messages: [
        {
          role: "system",
          content: "You are a connection healthcheck. Reply with ok only."
        },
        {
          role: "user",
          content: "Connection test."
        }
      ],
      temperature: 0,
      max_tokens: 8
    }),
    cache: "no-store"
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    throw new AiRequestError(`AI provider request failed: ${response.status}`, response.status, body);
  }

  return {
    ok: true,
    provider: config.provider,
    model: config.chatModel
  };
}
