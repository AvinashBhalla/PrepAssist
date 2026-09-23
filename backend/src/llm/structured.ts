import type { z } from "zod";
import { LLMError } from "./errors.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

export type StructuredGenerationOptions<T> = Omit<LLMRequest, "expectedOutput"> & {
  provider: LLMProvider;
  schema: z.ZodType<T>;
};

export type StructuredGenerationResult<T> = {
  data: T;
  response: LLMResponse;
};

export async function generateStructured<T>(options: StructuredGenerationOptions<T>): Promise<StructuredGenerationResult<T>> {
  const response = await options.provider.generate({
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    operation: options.operation,
    expectedOutput: { name: "structured_output" },
  });
  const jsonText = extractJsonText(response.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new LLMError("LLM_INVALID_RESPONSE", "LLM response was not valid JSON");
  }
  const validated = options.schema.safeParse(parsed);
  if (!validated.success) {
    throw new LLMError("LLM_SCHEMA_VALIDATION_FAILED", "LLM JSON did not match the expected schema", undefined, validated.error.issues);
  }
  return { data: validated.data, response };
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}
