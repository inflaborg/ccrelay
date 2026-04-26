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
 * Effective inbound client surface, including provider-based resolution for GET /v1/models
 * (no request body to detect OpenAI vs Anthropic).
 */
export function resolveInboundClientSurface(
  method: string,
  path: string,
  provider: Provider
): ApiSurface {
  const m = (method || "GET").toUpperCase();
  const p = normalizePath(path);
  if (m === "GET" && p === "/v1/models") {
    const fmt = provider.modelsListFormat ?? "auto";
    if (fmt === "openai") {
      return "openai";
    }
    if (fmt === "anthropic") {
      return "anthropic";
    }
    return provider.providerType === "openai" ? "openai" : "anthropic";
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

  return null;
}
