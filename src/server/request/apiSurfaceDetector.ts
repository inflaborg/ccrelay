/**
 * Inbound API surface detection from method + path.
 * Used to select request/response conversion without guessing from body shape.
 */

import type { ApiSurface } from "../../types";

/**
 * Returns the client's API wire format for this request, or null if unknown.
 * Unknown paths default to "anthropic" in RouterStage for backward compatibility.
 */
export function detectApiSurface(method: string, path: string): ApiSurface | null {
  const m = (method || "GET").toUpperCase();
  const p = path.startsWith("/") ? path : `/${path}`;

  if (p === "/v1/chat/completions" && m === "POST") {
    return "openai";
  }
  if (p === "/v1/models" && m === "GET") {
    return "openai";
  }
  if (p === "/v1/responses" && m === "POST") {
    return "openai_responses";
  }
  if ((p === "/v1/messages" || p === "/messages") && m === "POST") {
    return "anthropic";
  }
  if (p === "/v1/messages/count_tokens" && m === "POST") {
    return "anthropic";
  }

  return null;
}
