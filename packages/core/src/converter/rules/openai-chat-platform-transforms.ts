/**
 * Platform-specific transforms for OpenAI Chat Completions bodies (Anthropic client → OpenAI upstream).
 * Gemini OpenAI-compat quirks (Azure sanitization is hostname-based in `platform-transforms`).
 */

import type { OpenAIToolCall } from "../adapters/anthropic-to-openai-chat-request";

// --- Gemini OpenAI-compat ---

export function isGeminiOpenAiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini");
}

/**
 * Gemini OpenAI-compat expects extended-thinking signatures on tool calls, not a top-level
 * `reasoning_effort` field or a standalone assistant `thinking` blob.
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
