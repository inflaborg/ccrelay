/**
 * Chat Completions: some OpenAI models reject max_tokens and require max_completion_tokens.
 */

import type { OpenAIMessageRequest } from "../anthropic-to-openai";

/**
 * Models that expect completion budget under `max_completion_tokens` (not `max_tokens`).
 * Extend prefixes/patterns as new families ship.
 */
export function openaiChatUsesMaxCompletionTokens(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) {
    return true;
  }
  // o-series reasoning/chat ids: o1, o3, o4, …
  return /^o\d/.test(m);
}

/** Set exactly one of max_tokens / max_completion_tokens on the outbound Chat Completions body. */
export function assignOpenAiChatMaxOutput(openai: OpenAIMessageRequest, value: number): void {
  delete openai.max_tokens;
  delete openai.max_completion_tokens;
  if (openaiChatUsesMaxCompletionTokens(openai.model)) {
    openai.max_completion_tokens = value;
  } else {
    openai.max_tokens = value;
  }
}
