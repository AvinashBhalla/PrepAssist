import { loadLLMConfig, type LLMConfig } from "./config.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { OpenRouterProvider } from "./openrouter-provider.js";
import { generateStructured, type StructuredGenerationOptions } from "./structured.js";
import type { LLMProvider, LLMLogger } from "./types.js";
import type { LLMHttpOptions } from "./http.js";

export type LLMServiceDependencies = LLMHttpOptions & { logger?: LLMLogger };

export function createLLMProvider(config: LLMConfig = loadLLMConfig(), dependencies: LLMServiceDependencies = {}): LLMProvider {
  if (config.provider === "groq") return new GroqProvider(config, dependencies);
  if (config.provider === "gemini") return new GeminiProvider(config, dependencies);
  return new OpenRouterProvider(config, dependencies);
}

export function createLLMService(config: LLMConfig = loadLLMConfig(), dependencies: LLMServiceDependencies = {}) {
  const provider = createLLMProvider(config, dependencies);
  return {
    provider,
    generateStructured<T>(options: Omit<StructuredGenerationOptions<T>, "provider">) {
      return generateStructured({ ...options, provider });
    },
  };
}
