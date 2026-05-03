/**
 * Inbound API surface detection from method + path.
 * Used to select request/response conversion without guessing from body shape.
 */

import type { ApiSurface, Provider } from "../../types";

function normalizePath(path: string): string {
  const noQuery = path.split("?")[0] || path;
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
}

/**
 * Effective inbound client surface for logging / downstream use.
 * GET /v1/models is fixed to OpenAI (legacy); prefixed GET /anthropic/v1/models is anthropic via detectApiSurface.
 */
export function resolveInboundClientSurface(method: string, path: string, _provider: Provider): ApiSurface {
  void _provider;
  const m = (method || "GET").toUpperCase();
  const p = normalizePath(path);
  if (m === "GET" && p === "/v1/models") {
    return "openai";
  }
  return detectApiSurface(method, path) ?? "anthropic";
}

/**
 * Returns the client's API wire format for this request, or null if unknown.
 * Unknown paths default to "anthropic" in RouterStage for backward compatibility.
 */
export function detectApiSurface(method: string, path: string): ApiSurface | null {
  const m = (method || "GET").toUpperCase();
  const p = normalizePath(path);

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

  // OpenAI-prefixed (base_url ends with .../openai)
  if (p === "/openai/chat/completions" && m === "POST") {
    return "openai";
  }
  if (p === "/openai/models" && m === "GET") {
    return "openai";
  }
  if (p === "/openai/responses" && m === "POST") {
    return "openai_responses";
  }

  // Anthropic-prefixed (base_url ends with .../anthropic)
  if (p === "/anthropic/v1/messages" && m === "POST") {
    return "anthropic";
  }
  if (p === "/anthropic/v1/models" && m === "GET") {
    return "anthropic";
  }
  if (p === "/anthropic/v1/messages/count_tokens" && m === "POST") {
    return "anthropic";
  }

  return null;
}
