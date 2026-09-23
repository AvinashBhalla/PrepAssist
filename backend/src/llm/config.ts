import type { LLMProviderName } from "./types.js";
import { LLMError } from "./errors.js";

export type LLMConfig = {
  provider: LLMProviderName;
  groqApiKey?: string;
  geminiApiKey?: string;
  openrouterApiKey?: string;
  groqModel: string;
  geminiModel: string;
  openrouterModel: string;
  timeoutMs: number;
  maximumRetries: number;
  backoffBaseMs: number;
};

export function loadLLMConfig(environment: NodeJS.ProcessEnv = process.env): LLMConfig {
  const provider = environment.LLM_PROVIDER?.trim().toLowerCase() || "groq";
  if (provider !== "groq" && provider !== "gemini" && provider !== "openrouter") {
    throw new LLMError("LLM_CONFIGURATION_ERROR", "LLM_PROVIDER must be groq, gemini, or openrouter");
  }

  return {
    provider,
    groqApiKey: environment.GROQ_API_KEY?.trim() || undefined,
    geminiApiKey: environment.GEMINI_API_KEY?.trim() || undefined,
    openrouterApiKey: environment.OPENROUTER_API_KEY?.trim() || undefined,
    groqModel: environment.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    geminiModel: environment.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
    openrouterModel: environment.OPENROUTER_MODEL?.trim() || "openrouter/free",
    timeoutMs: parsePositiveInteger(environment.LLM_TIMEOUT_MS, 30_000),
    maximumRetries: parseNonNegativeInteger(environment.LLM_MAX_RETRIES, 2),
    backoffBaseMs: parsePositiveInteger(environment.LLM_BACKOFF_BASE_MS, 200),
  };
}

export function requireProviderApiKey(config: LLMConfig): string {
  const key = config.provider === "groq"
    ? config.groqApiKey
    : config.provider === "gemini"
      ? config.geminiApiKey
      : config.openrouterApiKey;
  if (!key) {
    throw new LLMError("LLM_CONFIGURATION_ERROR", `${config.provider.toUpperCase()}_API_KEY is required`);
  }
  return key;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
