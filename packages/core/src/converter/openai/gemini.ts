/** Gemini-specific shapes when translating Anthropic Messages → OpenAI Chat Completions. */

import type { OpenAIToolCall } from "../anthropic-to-openai";

export function isGeminiOpenAiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini");
}

/**
 * Gemini OpenAI-compat expects extended-thinking signatures on tool calls, not a top-level
 * `reasoning` field or a standalone assistant `thinking` blob.
 */
export function withOptionalGeminiThoughtSignature(
  toolCall: OpenAIToolCall,
  gemini: boolean,
  thoughtSignature: string | undefined
): OpenAIToolCall {
  if (gemini && thoughtSignature) {
    return {
      ...toolCall,
      /* eslint-disable @typescript-eslint/naming-convention -- Gemini wire (snake_case) */
      extra_content: {
        google: { thought_signature: thoughtSignature },
      },
    };
  }
  return toolCall;
}
