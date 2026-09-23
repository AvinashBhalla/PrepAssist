import { requireProviderApiKey, type LLMConfig } from "./config.js";
import { runProviderRequest, numberValue, type ProviderRuntimeOptions } from "./provider-base.js";
import type { LLMProvider, LLMRequest } from "./types.js";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly runtime: ProviderRuntimeOptions;

  constructor(config: LLMConfig, runtime: ProviderRuntimeOptions = {}) {
    this.model = config.geminiModel;
    this.apiKey = requireProviderApiKey(config);
    this.runtime = { ...runtime, timeoutMs: runtime.timeoutMs ?? config.timeoutMs, maximumRetries: runtime.maximumRetries ?? config.maximumRetries, backoffBaseMs: runtime.backoffBaseMs ?? config.backoffBaseMs };
  }

  generate(request: LLMRequest) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    return runProviderRequest({
      provider: this.name,
      model: this.model,
      request,
      url: endpoint,
      init: { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify(geminiBody(request)) },
      runtime: this.runtime,
      parse: parseGeminiResponse,
    });
  }
}

function geminiBody(request: LLMRequest) {
  return {
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
    generationConfig: {
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.expectedOutput ? { responseMimeType: "application/json" } : {}),
    },
  };
}

function parseGeminiResponse(data: unknown) {
  const value = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: unknown }>; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown } };
  const candidate = value.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text).find((part): part is string => typeof part === "string");
  if (!text) throw new Error("missing text");
  return { text, finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined, usage: { inputTokens: numberValue(value.usageMetadata?.promptTokenCount), outputTokens: numberValue(value.usageMetadata?.candidatesTokenCount), totalTokens: numberValue(value.usageMetadata?.totalTokenCount) } };
}
