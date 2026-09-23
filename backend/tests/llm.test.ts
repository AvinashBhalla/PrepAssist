import { describe, expect, it, vi } from "vitest";
import { loadLLMConfig } from "../src/llm/config.js";
import { LLMError } from "../src/llm/errors.js";
import { GeminiProvider } from "../src/llm/gemini-provider.js";
import { createLLMProvider } from "../src/llm/factory.js";
import { GroqProvider } from "../src/llm/groq-provider.js";
import { OpenRouterProvider } from "../src/llm/openrouter-provider.js";
import { generateStructured } from "../src/llm/structured.js";
import type { LLMConfig } from "../src/llm/config.js";
import type { LLMFetch } from "../src/llm/http.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";
import { z } from "zod";

function config(provider: LLMConfig["provider"]): LLMConfig {
  return {
    provider,
    groqApiKey: "groq-secret",
    geminiApiKey: "gemini-secret",
    openrouterApiKey: "openrouter-secret",
    groqModel: "groq-test-model",
    geminiModel: "gemini-test-model",
    openrouterModel: "openrouter/test-model",
    timeoutMs: 1_000,
    maximumRetries: 2,
    backoffBaseMs: 1,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const request = {
  systemPrompt: "You are a test assistant.",
  userPrompt: "Return a small object.",
  expectedOutput: { name: "test_object" },
  temperature: 0.2,
  maxOutputTokens: 100,
  operation: "test.operation",
};

describe("LLM configuration and provider selection", () => {
  it("selects each supported provider without exposing provider details to consumers", () => {
    expect(createLLMProvider(config("groq")).name).toBe("groq");
    expect(createLLMProvider(config("gemini")).name).toBe("gemini");
    expect(createLLMProvider(config("openrouter")).name).toBe("openrouter");
  });

  it("uses documented defaults and rejects an unknown provider", () => {
    const loaded = loadLLMConfig({ LLM_PROVIDER: "groq" });
    expect(loaded.groqModel).toBe("openai/gpt-oss-120b");
    expect(loaded.geminiModel).toBe("gemini-3.5-flash");
    expect(loaded.openrouterModel).toBe("openrouter/free");
    expect(() => loadLLMConfig({ LLM_PROVIDER: "unknown" })).toThrowError(LLMError);
  });

  it("rejects missing API key configuration", () => {
    const missingKey = { ...config("groq"), groqApiKey: undefined };
    expect(() => createLLMProvider(missingKey)).toThrow("GROQ_API_KEY is required");
  });
});

describe("provider request normalization", () => {
  it.each([
    ["groq", GroqProvider, "https://api.groq.com/openai/v1/chat/completions"],
    ["openrouter", OpenRouterProvider, "https://openrouter.ai/api/v1/chat/completions"],
  ] as const)("normalizes the %s chat request and response", async (name, Provider, expectedUrl) => {
    let requestedUrl = "";
    let requestedBody: Record<string, unknown> | undefined;
    const fetchImplementation: LLMFetch = async (url, init) => {
      requestedUrl = url;
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      });
    };
    const provider = new Provider(config(name), { fetchImplementation });
    const result = await provider.generate(request);

    expect(requestedUrl).toBe(expectedUrl);
    expect(requestedBody?.model).toBe(provider.model);
    expect(requestedBody?.response_format).toEqual({ type: "json_object" });
    expect(result).toEqual({
      text: "{\"ok\":true}",
      provider: name,
      model: provider.model,
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      finishReason: "stop",
    });
  });

  it("normalizes Gemini request and response", async () => {
    let requestedBody: Record<string, unknown> | undefined;
    const provider = new GeminiProvider(config("gemini"), {
      fetchImplementation: async (_url, init) => {
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 5, totalTokenCount: 7 },
        });
      },
    });
    const result = await provider.generate(request);

    expect(requestedBody?.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 100 });
    expect(result.provider).toBe("gemini");
    expect(result.usage.totalTokens).toBe(7);
    expect(result.finishReason).toBe("STOP");
  });
});

describe("LLM retry and error behavior", () => {
  it.each([429, 503])("retries transient status %s", async (status) => {
    const fetchImplementation = vi.fn<LLMFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "retry" }, status))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const provider = new GroqProvider(config("groq"), { fetchImplementation, sleep: async () => undefined });

    const result = await provider.generate(request);

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("ok");
  });

  it("does not retry authentication failures", async () => {
    const fetchImplementation = vi.fn<LLMFetch>().mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    const provider = new GroqProvider(config("groq"), { fetchImplementation, sleep: async () => undefined });

    await expect(provider.generate(request)).rejects.toMatchObject({ code: "LLM_AUTHENTICATION_FAILED" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("handles timeout and bounds retries", async () => {
    const fetchImplementation: LLMFetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const provider = new GroqProvider({ ...config("groq"), timeoutMs: 1, maximumRetries: 2 }, { fetchImplementation, sleep: async () => undefined });

    await expect(provider.generate(request)).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });

  it("converts malformed provider responses to typed errors", async () => {
    const provider = new GroqProvider(config("groq"), {
      fetchImplementation: async () => jsonResponse({ choices: [] }),
    });

    await expect(provider.generate(request)).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE" });
  });

  it("logs safe observations without secrets", async () => {
    const observations: unknown[] = [];
    const provider = new GroqProvider(config("groq"), {
      fetchImplementation: async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }),
      logger: (observation) => observations.push(observation),
    });

    await provider.generate(request);

    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain("groq-secret");
    expect(serialized).not.toContain("authorization");
    expect(observations).toHaveLength(1);
  });
});

describe("structured generation", () => {
  const response: LLMResponse = {
    text: "```json\n{\"answer\":\"ok\"}\n```",
    provider: "groq",
    model: "test",
    usage: {},
  };

  function fakeProvider(text: string): LLMProvider {
    return { name: "groq", model: "test", generate: async () => ({ ...response, text }) };
  }

  it("accepts valid JSON and validates it with Zod", async () => {
    const result = await generateStructured({
      provider: fakeProvider(response.text),
      systemPrompt: "system",
      userPrompt: "user",
      schema: z.object({ answer: z.string() }),
    });

    expect(result.data).toEqual({ answer: "ok" });
  });

  it("rejects malformed JSON without fabricating data", async () => {
    await expect(generateStructured({
      provider: fakeProvider("not json"),
      systemPrompt: "system",
      userPrompt: "user",
      schema: z.object({ answer: z.string() }),
    })).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE" });
  });

  it("rejects valid JSON that fails the supplied schema", async () => {
    await expect(generateStructured({
      provider: fakeProvider("{\"answer\":42}"),
      systemPrompt: "system",
      userPrompt: "user",
      schema: z.object({ answer: z.string() }),
    })).rejects.toMatchObject({ code: "LLM_SCHEMA_VALIDATION_FAILED" });
  });
});