import { LLMError } from "./errors.js";

export type LLMFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LLMHttpOptions = {
  fetchImplementation?: LLMFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maximumRetries?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
};

export type LLMHttpResult = {
  data: unknown;
  retryCount: number;
};

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

export async function requestLLMJson(
  url: string,
  init: RequestInit,
  options: LLMHttpOptions = {},
): Promise<LLMHttpResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maximumRetries = options.maximumRetries ?? 2;
  const backoffBaseMs = options.backoffBaseMs ?? 200;
  const maxBackoffMs = options.maxBackoffMs ?? 2_000;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maximumRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImplementation(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        const shouldRetry = retryableStatuses.has(response.status) && attempt < maximumRetries;
        if (shouldRetry) {
          retryCount += 1;
          await sleep(Math.min(getRetryDelay(response, backoffBaseMs * 2 ** attempt), maxBackoffMs));
          continue;
        }
        throw errorForStatus(response.status);
      }

      try {
        return { data: await response.json(), retryCount };
      } catch {
        throw new LLMError("LLM_INVALID_RESPONSE", "LLM provider returned invalid JSON");
      }
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof LLMError) throw error;

      if (controller.signal.aborted) {
        if (attempt < maximumRetries) {
          retryCount += 1;
          await sleep(Math.min(backoffBaseMs * 2 ** attempt, maxBackoffMs));
          continue;
        }
        throw new LLMError("LLM_TIMEOUT", "LLM provider request timed out");
      }

      if (attempt < maximumRetries) {
        retryCount += 1;
        await sleep(Math.min(backoffBaseMs * 2 ** attempt, maxBackoffMs));
        continue;
      }
      throw new LLMError("LLM_PROVIDER_UNAVAILABLE", "LLM provider request failed");
    }
  }

  throw new LLMError("LLM_PROVIDER_UNAVAILABLE", "LLM provider request failed");
}

function errorForStatus(status: number): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError("LLM_AUTHENTICATION_FAILED", "LLM provider authentication failed", status);
  }
  if (status === 429) {
    return new LLMError("LLM_RATE_LIMITED", "LLM provider rate limit reached", status);
  }
  if (status >= 500) {
    return new LLMError("LLM_PROVIDER_UNAVAILABLE", "LLM provider is unavailable", status);
  }
  return new LLMError("LLM_INVALID_RESPONSE", "LLM provider rejected the request", status);
}

function getRetryDelay(response: Response, fallback: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}
