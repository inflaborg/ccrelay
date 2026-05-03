/**
 * Path utilities: OpenAI wire detection, provider type checks, and cross-protocol upstream path mapping.
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

function pathOnly(pathOrUrlPath: string): string {
  const bare = pathOrUrlPath.split("?")[0] || pathOrUrlPath;
  return bare.startsWith("/") ? bare : `/${bare}`;
}

/**
 * Maps Anthropic-shape upstream-relative paths (after inbound prefix strip) when the upstream
 * provider speaks OpenAI wire (`providerType` `openai` / `openai_chat`).
 *
 * Canonical Anthropic Messages path is `/v1/messages` only.
 */
export function mapAnthropicWirePathToOpenAiUpstream(path: string, method: string): string {
  const m = (method || "GET").toUpperCase();
  const p = pathOnly(path);
  if (m === "GET" && p === "/v1/models") {
    return "/models";
  }
  if (m === "POST" && p === "/v1/messages") {
    return "/chat/completions";
  }
  return path;
}

/**
 * Maps OpenAI-shape upstream-relative paths when the upstream provider speaks Anthropic wire.
 *
 * Input paths are client OpenAI wire canonical (e.g. `/models`, `/chat/completions`; not `/v1/models` for models).
 */
export function mapOpenAiWirePathToAnthropicUpstream(path: string, method: string): string {
  const m = (method || "GET").toUpperCase();
  const p = pathOnly(path);
  if (m === "GET" && p === "/models") {
    return "/v1/models";
  }
  if (m === "POST" && isOpenAIChatCompletionsWirePath(p)) {
    return "/v1/messages";
  }
  return path;
}
