/**
 * Cross-protocol conversion for GET /models list responses (OpenAI vs Anthropic wire).
 */
/* eslint-disable @typescript-eslint/naming-convention -- API wire uses snake_case */

export interface OpenAIModelsListResponse {
  object: "list";
  data: OpenAIModelEntry[];
}

export interface OpenAIModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

/** Anthropic list models (minimal; see https://docs.anthropic.com/en/api/models-list) */
export interface AnthropicModelInfo {
  id: string;
  type: "model";
  display_name: string;
}

export interface AnthropicModelsListResponse {
  data: AnthropicModelInfo[];
  first_id: string | null;
  has_more: boolean;
  last_id: string | null;
}

/**
 * Path segment for upstream models listing (pathname only).
 * Matches OpenAI `/v1/models` (often rewritten to `/models` on wire) after prefix stripping.
 */
export function isModelsListUpstreamPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return p === "/models" || p === "/v1/models";
}

/** Minimal structural check before treating body as OpenAI models list. */
export function isOpenAIModelsListJson(parsed: Record<string, unknown>): boolean {
  return parsed.object === "list" && Array.isArray(parsed.data);
}

/** Minimal structural check before treating body as Anthropic models list. */
export function isAnthropicModelsListJson(parsed: Record<string, unknown>): boolean {
  return Array.isArray(parsed.data);
}

/**
 * Convert an OpenAI-format models list response to Anthropic format
 */
export function convertOpenAIModelsToAnthropic(
  openai: OpenAIModelsListResponse
): AnthropicModelsListResponse {
  const data: AnthropicModelInfo[] = (openai.data ?? []).map(entry => ({
    id: entry.id,
    type: "model" as const,
    display_name: entry.id,
  }));
  return {
    data,
    first_id: data.length > 0 ? data[0].id : null,
    has_more: false,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
  };
}

/**
 * Convert an Anthropic-format models list response to OpenAI format
 */
export function convertAnthropicModelsToOpenAI(
  anthropic: AnthropicModelsListResponse
): OpenAIModelsListResponse {
  const now = Math.floor(Date.now() / 1000);
  const data: OpenAIModelEntry[] = (anthropic.data ?? []).map(entry => ({
    id: entry.id,
    object: "model" as const,
    created: now,
    owned_by: "ccrelay",
  }));
  return { object: "list", data };
}
