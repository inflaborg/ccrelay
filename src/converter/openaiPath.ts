/**
 * OpenAI path utilities for protocol detection and type checks.
 */

import type { ProviderType } from "../types";

/**
 * True if `originalPath` is a recognized OpenAI Chat Completions endpoint.
 */
export function isOpenAIChatCompletionsWirePath(originalPath: string): boolean {
  return originalPath === "/chat/completions" || originalPath === "/v1/chat/completions";
}

/**
 * True if the provider type is any OpenAI variant (full or chat-only).
 */
export function isOpenAIType(providerType: ProviderType): boolean {
  return providerType === "openai" || providerType === "openai_chat";
}
