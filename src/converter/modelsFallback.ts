/**
 * Synthetic OpenAI /v1/models list when upstream returns an error
 */
/* eslint-disable @typescript-eslint/naming-convention -- OpenAI API uses snake_case */

import type { Provider } from "../types";

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

/**
 * Build a minimal OpenAI-style model list from provider.modelMap, or a placeholder
 */
export function buildModelsListFromProvider(provider: Provider): OpenAIModelsListResponse {
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
