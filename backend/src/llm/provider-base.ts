import { LLMError } from "./errors.js";
import { requestLLMJson, type LLMFetch, type LLMHttpOptions } from "./http.js";
import type { LLMLogger, LLMRequest, LLMResponse, LLMUsage } from "./types.js";

export type ProviderRuntimeOptions = LLMHttpOptions & {
  logger?: LLMLogger;
};

export async function runProviderRequest<T>(input: {
  provider: LLMResponse["provider"];
  model: string;
  request: LLMRequest;
  url: string;
  init: RequestInit;
  runtime: ProviderRuntimeOptions;
  parse: (data: unknown) => { text: string; usage: LLMUsage; finishReason?: string };
}): Promise<LLMResponse> {
  const startedAt = Date.now();
  const operation = input.request.operation ?? "llm.generate";
  let retryCount = 0;

  try {
    const result = await requestLLMJson(input.url, input.init, input.runtime);
    retryCount = result.retryCount;
    const parsed = input.parse(result.data);
    const response = { ...parsed, provider: input.provider, model: input.model };
    input.runtime.logger?.({ provider: input.provider, model: input.model, operation, durationMs: Date.now() - startedAt, retryCount, success: true, usage: parsed.usage });
    return response;
  } catch (error) {
    if (error instanceof LLMError) {
      input.runtime.logger?.({ provider: input.provider, model: input.model, operation, durationMs: Date.now() - startedAt, retryCount, success: false, errorCode: error.code });
      throw error;
    }
    input.runtime.logger?.({ provider: input.provider, model: input.model, operation, durationMs: Date.now() - startedAt, retryCount, success: false, errorCode: "LLM_INVALID_RESPONSE" });
    throw new LLMError("LLM_INVALID_RESPONSE", "LLM provider response could not be normalized");
  }
}

export function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new LLMError("LLM_INVALID_RESPONSE", "LLM provider returned no text response");
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function jsonHeaders(apiKey: string): HeadersInit {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

export type ProviderFetch = LLMFetch;
