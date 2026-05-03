/**
 * Cross-protocol conversion for GET /models list responses (OpenAI vs Anthropic wire).
 */
/* eslint-disable @typescript-eslint/naming-convention -- API wire uses snake_case */

import * as url from "url";
import type { ApiSurface, Provider } from "../types";
import {
  providerHasConfigurableModelMap,
  clientFacingModelIdForModelsList,
} from "../utils/model-map";

/**
 * Drop duplicate `id` rows (first wins, order preserved). Mutates `data` in place.
 * Rows without a string `id` are kept (never deduped against each other).
 */
function dedupeModelsListDataRowsInPlace(data: Array<Record<string, unknown>>): boolean {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  let removed = false;
  for (const row of data) {
    if (typeof row.id !== "string") {
      out.push(row);
      continue;
    }
    if (seen.has(row.id)) {
      removed = true;
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  if (!removed) {
    return false;
  }
  data.length = 0;
  for (const r of out) {
    data.push(r);
  }
  return true;
}

/** Dedupe duplicate ids after mapping (stable, first wins). */
function dedupeMappedIdsPreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

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

/**
 * Parse GET /models `limit` from a provider target URL query string (digits only).
 * Invalid, missing, or non-positive → `undefined` (return full configured list).
 */
export function parseModelsListLimitFromTargetUrl(targetUrl: string): number | undefined {
  const parsed = url.parse(targetUrl, true);
  const raw = parsed.query?.limit;
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (typeof token !== "string") {
    return undefined;
  }
  const s = token.trim();
  if (!/^\d+$/.test(s)) {
    return undefined;
  }
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return n;
}

/** Build minimal OpenAI `list` payload from model ids (custom models list synthesis). */
export function buildOpenAIModelsListFromIds(
  modelIds: string[],
  provider?: Provider
): OpenAIModelsListResponse {
  const now = Math.floor(Date.now() / 1000);
  const ids =
    provider && providerHasConfigurableModelMap(provider)
      ? modelIds.map(id => clientFacingModelIdForModelsList(id, provider))
      : modelIds;
  const uniqueIds = dedupeMappedIdsPreserveOrder(ids);
  return {
    object: "list",
    data: uniqueIds.map(id => ({
      id,
      object: "model" as const,
      created: now,
      owned_by: "ccrelay",
    })),
  };
}

/**
 * Rewrite model ids in an OpenAI or Anthropic models list JSON (mutates `parsed`).
 * @returns Whether any id (or Anthropic display_name) was changed.
 */
export function rewriteModelsListPayloadInPlace(
  parsed: Record<string, unknown>,
  provider: Provider
): boolean {
  if (!providerHasConfigurableModelMap(provider)) {
    return false;
  }
  let changed = false;
  if (isOpenAIModelsListJson(parsed)) {
    const data = parsed.data as Array<Record<string, unknown>>;
    for (const row of data) {
      if (typeof row.id === "string") {
        const next = clientFacingModelIdForModelsList(row.id, provider);
        if (next !== row.id) {
          row.id = next;
          changed = true;
        }
      }
    }
    if (dedupeModelsListDataRowsInPlace(data)) {
      changed = true;
    }
  } else if (isAnthropicModelsListJson(parsed)) {
    const data = parsed.data as Array<Record<string, unknown>>;
    for (const row of data) {
      if (typeof row.id !== "string") {
        continue;
      }
      const origId = row.id;
      const next = clientFacingModelIdForModelsList(origId, provider);
      if (next !== origId) {
        row.id = next;
        if (typeof row.display_name === "string" && row.display_name === origId) {
          row.display_name = next;
        }
        changed = true;
      }
    }
    if (dedupeModelsListDataRowsInPlace(data)) {
      changed = true;
    }
    if (changed && Array.isArray(data) && data.length > 0) {
      const first = data[0]?.id;
      const last = data[data.length - 1]?.id;
      if (typeof first === "string") {
        parsed.first_id = first;
      }
      if (typeof last === "string") {
        parsed.last_id = last;
      }
    }
  }
  return changed;
}

/** Like {@link convertOpenAIModelsToAnthropic}, but callers set `has_more` for pagination. */
export function openAiModelsPageToAnthropicModelsList(
  openaiPage: OpenAIModelsListResponse,
  hasMore: boolean
): AnthropicModelsListResponse {
  const anthropicBase = convertOpenAIModelsToAnthropic(openaiPage);
  return { ...anthropicBase, has_more: hasMore };
}

/**
 * JSON response body for a locally synthesized models list (`useCustomModelsList`).
 * Applies optional `limit` from `targetUrl`; `has_more` only on Anthropic wire.
 */
export function synthesizeCustomModelsListBody(options: {
  clientSurface: ApiSurface;
  fullModelIds: string[];
  targetUrl: string;
  provider: Provider;
}): string {
  const limit = parseModelsListLimitFromTargetUrl(options.targetUrl);
  const full = options.fullModelIds;
  const pageIds = limit !== undefined ? full.slice(0, limit) : [...full];
  const hasMore = pageIds.length < full.length;
  const openaiPage = buildOpenAIModelsListFromIds(pageIds, options.provider);

  if (options.clientSurface === "anthropic") {
    return JSON.stringify(openAiModelsPageToAnthropicModelsList(openaiPage, hasMore));
  }
  return JSON.stringify(openaiPage);
}
