/**
 * OpenAI Chat Completions: model-dependent wire rules (official API semantics by model id).
 * Extend this module as new model families need different fields or bounds.
 */

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Chat Completions wire field names */

/** Minimal body shape for max output field assignment */
export interface OpenAiChatMaxOutputTarget {
  model: string;
  max_tokens?: number;
  max_completion_tokens?: number;
}

/**
 * Models that expect completion budget under `max_completion_tokens` (not `max_tokens`).
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
export function assignOpenAiChatMaxOutput(openai: OpenAiChatMaxOutputTarget, value: number): void {
  delete openai.max_tokens;
  delete openai.max_completion_tokens;
  if (openaiChatUsesMaxCompletionTokens(openai.model)) {
    openai.max_completion_tokens = value;
  } else {
    openai.max_tokens = value;
  }
}
