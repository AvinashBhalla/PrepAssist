export type LLMProviderName = "groq" | "gemini" | "openrouter";

export type LLMStructuredOutput = {
  name?: string;
};

export type LLMRequest = {
  systemPrompt: string;
  userPrompt: string;
  expectedOutput?: LLMStructuredOutput;
  temperature?: number;
  maxOutputTokens?: number;
  operation?: string;
};

export type LLMUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LLMResponse = {
  text: string;
  provider: LLMProviderName;
  model: string;
  usage: LLMUsage;
  finishReason?: string;
};

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}

export type LLMObservation = {
  provider: LLMProviderName;
  model: string;
  operation: string;
  durationMs: number;
  retryCount: number;
  success: boolean;
  usage?: LLMUsage;
  errorCode?: string;
};

export type LLMLogger = (observation: LLMObservation) => void;
