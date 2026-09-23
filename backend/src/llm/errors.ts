export type LLMErrorCode =
  | "LLM_AUTHENTICATION_FAILED"
  | "LLM_RATE_LIMITED"
  | "LLM_TIMEOUT"
  | "LLM_PROVIDER_UNAVAILABLE"
  | "LLM_INVALID_RESPONSE"
  | "LLM_SCHEMA_VALIDATION_FAILED"
  | "LLM_CONFIGURATION_ERROR";

export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
