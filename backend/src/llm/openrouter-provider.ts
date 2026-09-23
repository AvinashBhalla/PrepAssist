import { requireProviderApiKey, type LLMConfig } from "./config.js";
import { runProviderRequest, jsonHeaders, numberValue, type ProviderRuntimeOptions } from "./provider-base.js";
import type { LLMProvider, LLMRequest } from "./types.js";

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly runtime: ProviderRuntimeOptions;

  constructor(config: LLMConfig, runtime: ProviderRuntimeOptions = {}) {
    this.model = config.openrouterModel;
    this.apiKey = requireProviderApiKey(config);
    this.runtime = { ...runtime, timeoutMs: runtime.timeoutMs ?? config.timeoutMs, maximumRetries: runtime.maximumRetries ?? config.maximumRetries, backoffBaseMs: runtime.backoffBaseMs ?? config.backoffBaseMs };
  }

  generate(request: LLMRequest) {
    return runProviderRequest({
      provider: this.name,
      model: this.model,
      request,
      url: "https://openrouter.ai/api/v1/chat/completions",
      init: { method: "POST", headers: jsonHeaders(this.apiKey), body: JSON.stringify(chatBody(this.model, request)) },
      runtime: this.runtime,
      parse: parseChatResponse,
    });
  }
}

function chatBody(model: string, request: LLMRequest) {
  return {
    model,
    messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: request.userPrompt }],
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.expectedOutput ? { response_format: { type: "json_object" } } : {}),
  };
}

function parseChatResponse(data: unknown) {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> }).choices?.[0];
  const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }).usage;
  if (typeof choice?.message?.content !== "string") throw new Error("missing text");
  return { text: choice.message.content, finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined, usage: { inputTokens: numberValue(usage?.prompt_tokens), outputTokens: numberValue(usage?.completion_tokens), totalTokens: numberValue(usage?.total_tokens) } };
}
