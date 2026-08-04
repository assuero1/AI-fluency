type TranslationResponse = {
  ok?: boolean;
  translation?: string;
  error?: string;
};

type TranslationRequestOptions = {
  fetcher?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
};

class TranslationRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;

export async function requestTranslation(
  text: string,
  sourceLanguage: string | undefined,
  options: TranslationRequestOptions = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceLanguage }),
        signal: controller.signal
      });
      const data = await readTranslationResponse(response);

      if (response.ok && data?.ok && data.translation?.trim()) return data.translation.trim();

      throw new TranslationRequestError(data?.error ?? "Tradução indisponível.", isRetryableResponse(response.status));
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Tradução indisponível.");
      const canRetry = normalizedError instanceof TranslationRequestError
        ? normalizedError.retryable
        : isRetryableError(normalizedError);
      if (!canRetry || attempt === 1) throw normalizedError;
      lastError = normalizedError;
    } finally {
      clearTimeout(timeoutId);
    }

    await wait(retryDelayMs);
  }

  throw lastError ?? new Error("Tradução indisponível.");
}

async function readTranslationResponse(response: Response): Promise<TranslationResponse | null> {
  try {
    return await response.json() as TranslationResponse;
  } catch {
    return null;
  }
}

function isRetryableResponse(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: Error) {
  return error.name === "AbortError" || error instanceof TypeError || /fetch failed|network|timed out|timeout/i.test(error.message);
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
