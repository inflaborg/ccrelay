/**
 * Cross-protocol upstream path mapping (Anthropic wire vs OpenAI wire).
 * Shared by request processing and body converters so GET (no body) and POST use the same path
 * rules once `needsConversion` is true.
 */

import { isOpenAIChatCompletionsWirePath } from "./openaiPath";

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
