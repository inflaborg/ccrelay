/**
 * Resolves the upstream path for OpenAI Chat Completions after protocol conversion
 * (Anthropic → OpenAI, OpenAI Responses → Chat Completions).
 */

import type { Provider } from "../types";

export const DEFAULT_OPENAI_CHAT_COMPLETIONS_PATH = "/chat/completions" as const;

export type OpenAIPathProvider = Pick<Provider, "openaiChatCompletionsPath">;

export function getOpenAIChatCompletionsPath(provider?: OpenAIPathProvider | null): string {
  const p = provider?.openaiChatCompletionsPath;
  if (p && p.length > 0) {
    return p.trim();
  }
  return DEFAULT_OPENAI_CHAT_COMPLETIONS_PATH;
}

/**
 * True if `originalPath` is the OpenAI Chat Completions endpoint for this provider
 * (including legacy literals when provider is unknown).
 */
export function isOpenAIChatCompletionsWirePath(
  originalPath: string,
  provider?: OpenAIPathProvider | null
): boolean {
  if (originalPath === "/v1/chat/completions" || originalPath === "/chat/completions") {
    return true;
  }
  if (provider && originalPath === getOpenAIChatCompletionsPath(provider)) {
    return true;
  }
  return false;
}
