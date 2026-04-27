/**
 * Synthetic /v1/models list when upstream returns an error
 */
/* eslint-disable @typescript-eslint/naming-convention -- API wire uses snake_case */

import type { ModelsListFormat, Provider } from "../types";

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

  for (const entry of provider.modelMap ?? []) {
    data.push({
      id: entry.model,
      object: "model",
      created: now,
      owned_by: "ccrelay",
    });
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

  for (const entry of provider.modelMap ?? []) {
    data.push({
      id: entry.model,
      type: "model",
      display_name: entry.model,
    });
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
  return provider.providerType === "openai"
    ? buildOpenAIModelsListFromProvider(provider)
    : buildAnthropicModelsListFromProvider(provider);
}

export { buildOpenAIModelsListFromProvider as buildModelsListFromProvider };
