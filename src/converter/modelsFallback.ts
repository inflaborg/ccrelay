/**
 * Synthetic /v1/models list when upstream returns an error
 */
/* eslint-disable @typescript-eslint/naming-convention -- API wire uses snake_case */

import type { ModelsListFormat, Provider } from "../types";
import { isOpenAIType } from "./openaiPath";

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
 * Build a minimal OpenAI-style model list from provider.modelMap, or a placeholder
 */
export function buildOpenAIModelsListFromProvider(provider: Provider): OpenAIModelsListResponse {
  const data: OpenAIModelEntry[] = [];
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();

  for (const entry of provider.modelMap ?? []) {
    // Always show the pattern name (what clients should use)
    if (!seen.has(entry.pattern)) {
      seen.add(entry.pattern);
      data.push({
        id: entry.pattern,
        object: "model",
        created: now,
        owned_by: "ccrelay",
      });
    }
    // Also show the target model name if different
    if (entry.pattern !== entry.model && !seen.has(entry.model)) {
      seen.add(entry.model);
      data.push({
        id: entry.model,
        object: "model",
        created: now,
        owned_by: "ccrelay",
      });
    }
  }

  if (data.length === 0) {
    data.push({
      id: "unknown",
      object: "model",
      created: now,
      owned_by: provider.id,
    });
  }

  return { object: "list", data };
}

/**
 * Build a minimal Anthropic-style model list from provider.modelMap
 */
export function buildAnthropicModelsListFromProvider(
  provider: Provider
): AnthropicModelsListResponse {
  const data: AnthropicModelInfo[] = [];
  const seen = new Set<string>();

  for (const entry of provider.modelMap ?? []) {
    // Always show the pattern name (what clients should use)
    if (!seen.has(entry.pattern)) {
      seen.add(entry.pattern);
      data.push({
        id: entry.pattern,
        type: "model",
        display_name: entry.pattern,
      });
    }
    // Also show the target model name if different
    if (entry.pattern !== entry.model && !seen.has(entry.model)) {
      seen.add(entry.model);
      data.push({
        id: entry.model,
        type: "model",
        display_name: entry.model,
      });
    }
  }

  if (data.length === 0) {
    const id = "unknown";
    data.push({
      id,
      type: "model",
      display_name: id,
    });
  }

  const first = data[0].id;
  const last = data[data.length - 1].id;

  return {
    data,
    first_id: first,
    has_more: false,
    last_id: last,
  };
}

/**
 * Resolves which synthetic list to return from `GET /v1/models` error fallback
 */
export function buildModelsListFallback(
  provider: Provider
): OpenAIModelsListResponse | AnthropicModelsListResponse {
  const fmt: ModelsListFormat = provider.modelsListFormat ?? "auto";
  if (fmt === "openai") {
    return buildOpenAIModelsListFromProvider(provider);
  }
  if (fmt === "anthropic") {
    return buildAnthropicModelsListFromProvider(provider);
  }
  return isOpenAIType(provider.providerType)
    ? buildOpenAIModelsListFromProvider(provider)
    : buildAnthropicModelsListFromProvider(provider);
}

export { buildOpenAIModelsListFromProvider as buildModelsListFromProvider };

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
