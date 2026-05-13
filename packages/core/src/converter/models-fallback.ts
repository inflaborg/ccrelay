/**
 * Cross-protocol conversion for GET /models list responses (OpenAI vs Anthropic wire).
 */
/* eslint-disable @typescript-eslint/naming-convention -- API wire uses snake_case */

import * as url from "url";
import type { ApiSurface, Provider } from "../types";

/** Client sends this header so GET /models uses {@link ParsedCustomModelLine.alias} as wire `id`. */
export const CCRELAY_MODEL_ALIAS_HEADER = "x-ccrelay-model-alias";

/**
 * True when the client requested alias mode for synthetic custom model lists.
 * Treats empty, `0`, `false`, `no` (case-insensitive) as off.
 */
export function readUseModelAliasFromHeaders(headers: Record<string, string>): boolean {
  let raw: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === CCRELAY_MODEL_ALIAS_HEADER) {
      raw = v;
      break;
    }
  }
  if (raw === undefined) {
    return false;
  }
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "0" || t === "false" || t === "no") {
    return false;
  }
  return true;
}

/**
 * Parsed row from `customModelsList`:
 * - `realId` — upstream model id
 * - `realId;displayName` — display label; alias defaults to realId
 * - `realId;displayName;alias` — optional Cowork-safe wire id
 * - `realId;;alias` — displayName falls back to realId
 */
export interface ParsedCustomModelLine {
  /** Real upstream model id */
  id: string;
  displayName: string;
  /** Wire id for clients that send {@link CCRELAY_MODEL_ALIAS_HEADER}; equals `id` when not aliasing */
  alias: string;
}

/**
 * Split on the first two `;` segments. Further `;` characters belong to `alias`.
 * No `;` → all three equal trimmed line. One `;` → alias = id.
 */
export function parseCustomModelLine(line: string): ParsedCustomModelLine {
  const s = line.trim();
  if (!s) {
    return { id: "", displayName: "", alias: "" };
  }
  const i1 = s.indexOf(";");
  if (i1 === -1) {
    return { id: s, displayName: s, alias: s };
  }
  const id = s.slice(0, i1).trim();
  const rest = s.slice(i1 + 1);
  const i2 = rest.indexOf(";");
  if (i2 === -1) {
    const displayPart = rest.trim();
    const displayName = displayPart.length > 0 ? displayPart : id;
    return { id, displayName, alias: id };
  }
  const displayPart = rest.slice(0, i2).trim();
  const aliasPart = rest.slice(i2 + 1).trim();
  const displayName = displayPart.length > 0 ? displayPart : id;
  const alias = aliasPart.length > 0 ? aliasPart : id;
  return { id, displayName, alias };
}

/** Parse each line and dedupe by parsed real `id` (first occurrence wins). */
export function collectParsedCustomModelsDeduped(lines: string[]): ParsedCustomModelLine[] {
  const seen = new Set<string>();
  const out: ParsedCustomModelLine[] = [];
  for (const line of lines) {
    const parsed = parseCustomModelLine(line);
    if (!parsed.id) {
      continue;
    }
    if (seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    out.push(parsed);
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
  /** Present on synthesized custom lists when display name differs from `id`. */
  display_name?: string;
}

/** Anthropic model entry (see https://docs.anthropic.com/en/api/models-list) */
export interface AnthropicModelInfo {
  id: string;
  type: "model";
  display_name: string;
  /** RFC 3339 datetime */
  created_at: string;
  max_input_tokens: number;
  max_tokens: number;
}

export interface AnthropicModelsListResponse {
  data: AnthropicModelInfo[];
  first_id: string | null;
  has_more: boolean;
  last_id: string | null;
}

function pathOnly(pathOrUrlPath: string): string {
  const bare = pathOrUrlPath.split("?")[0] || pathOrUrlPath;
  return bare.startsWith("/") ? bare : `/${bare}`;
}

/**
 * Path segment for upstream models listing (pathname only).
 * Matches OpenAI `/v1/models` (often rewritten to `/models` on wire) after prefix stripping.
 */
export function isModelsListUpstreamPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return p === "/models" || p === "/v1/models";
}

/**
 * True for `GET /models/{id}` or `GET /v1/models/{id}` (pathname only; query stripped).
 * Not true for bare `/models` or `/v1/models`.
 */
export function isModelDetailUpstreamPath(path: string): boolean {
  return extractModelIdFromDetailPath(path) !== null;
}

/**
 * Returns the first path segment after `/models/` or `/v1/models/`, URL-decoded, or `null` if missing.
 */
export function extractModelIdFromDetailPath(path: string): string | null {
  const p = pathOnly(path);
  let rest: string;
  if (p.startsWith("/v1/models/")) {
    rest = p.slice("/v1/models/".length);
  } else if (p.startsWith("/models/")) {
    rest = p.slice("/models/".length);
  } else {
    return null;
  }
  const seg = rest.split("/")[0]?.trim() ?? "";
  if (!seg) {
    return null;
  }
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Minimal structural check before treating body as OpenAI models list. */
export function isOpenAIModelsListJson(parsed: Record<string, unknown>): boolean {
  return parsed.object === "list" && Array.isArray(parsed.data);
}

/** Minimal structural check before treating body as Anthropic models list. */
export function isAnthropicModelsListJson(parsed: Record<string, unknown>): boolean {
  return Array.isArray(parsed.data);
}

/** Single OpenAI model object (retrieve model), not a list wrapper. */
export function isOpenAIModelEntryJson(parsed: Record<string, unknown>): boolean {
  return parsed.object === "model" && typeof parsed.id === "string" && !Array.isArray(parsed.data);
}

/** Single Anthropic model object (retrieve model), not a list wrapper. */
export function isAnthropicModelInfoJson(parsed: Record<string, unknown>): boolean {
  return parsed.type === "model" && typeof parsed.id === "string" && !Array.isArray(parsed.data);
}

function createdAtIsoFromOpenAiCreated(created: number): string {
  const sec = Number.isFinite(created) ? created : Math.floor(Date.now() / 1000);
  return new Date(sec * 1000).toISOString();
}

/**
 * Convert one OpenAI model entry to Anthropic `ModelInfo` shape.
 */
export function convertOpenAISingleModelToAnthropic(entry: OpenAIModelEntry): AnthropicModelInfo {
  const raw = entry.display_name;
  const display = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : entry.id;
  return {
    id: entry.id,
    type: "model",
    display_name: display,
    created_at: createdAtIsoFromOpenAiCreated(entry.created),
    max_input_tokens: 0,
    max_tokens: 0,
  };
}

/**
 * Convert one Anthropic model entry to OpenAI model object shape.
 */
export function convertAnthropicSingleModelToOpenAI(entry: {
  id: string;
  display_name?: string;
  created_at?: string;
}): OpenAIModelEntry {
  const raw = entry.display_name;
  const display = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : entry.id;
  const ts = entry.created_at ? Date.parse(entry.created_at) : Number.NaN;
  const created = Number.isFinite(ts) ? Math.floor(ts / 1000) : Math.floor(Date.now() / 1000);
  return {
    id: entry.id,
    object: "model",
    created,
    owned_by: "ccrelay",
    ...(display !== entry.id ? { display_name: display } : {}),
  };
}

/**
 * Convert an OpenAI-format models list response to Anthropic format
 */
export function convertOpenAIModelsToAnthropic(
  openai: OpenAIModelsListResponse
): AnthropicModelsListResponse {
  const data: AnthropicModelInfo[] = (openai.data ?? []).map(entry =>
    convertOpenAISingleModelToAnthropic(entry)
  );
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
  const data: OpenAIModelEntry[] = (anthropic.data ?? []).map(entry =>
    convertAnthropicSingleModelToOpenAI(entry)
  );
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

/**
 * Build minimal OpenAI `list` payload from custom list lines.
 * When `useAlias` is true, each entry's wire `id` is {@link ParsedCustomModelLine.alias}; otherwise {@link ParsedCustomModelLine.id}.
 * Optional `display_name` is set when it differs from wire id.
 */
export function buildOpenAIModelsListFromIds(
  modelLines: string[],
  useAlias: boolean
): OpenAIModelsListResponse {
  const now = Math.floor(Date.now() / 1000);
  const entries = collectParsedCustomModelsDeduped(modelLines);
  return {
    object: "list",
    data: entries.map(({ id, displayName, alias }) => {
      const wireId = useAlias ? alias : id;
      return {
        id: wireId,
        object: "model" as const,
        created: now,
        owned_by: "ccrelay",
        ...(displayName !== wireId ? { display_name: displayName } : {}),
      };
    }),
  };
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
  /** Raw lines from `customModelsList` (see {@link parseCustomModelLine}). */
  fullModelLines: string[];
  targetUrl: string;
  provider: Provider;
  /** When true, list/detail wire ids use alias segment (Cowork-safe). */
  useAlias: boolean;
}): string {
  const limit = parseModelsListLimitFromTargetUrl(options.targetUrl);
  const full = options.fullModelLines;
  const pageLines = limit !== undefined ? full.slice(0, limit) : [...full];
  const hasMore = pageLines.length < full.length;
  const openaiPage = buildOpenAIModelsListFromIds(pageLines, options.useAlias);

  if (options.clientSurface === "anthropic") {
    return JSON.stringify(openAiModelsPageToAnthropicModelsList(openaiPage, hasMore));
  }
  return JSON.stringify(openaiPage);
}

/**
 * JSON body for `GET .../models/{id}` when `useCustomModelsList` matches one line.
 * Returns `null` when the model id is not in the configured list.
 */
export function synthesizeCustomModelDetailBody(options: {
  clientSurface: ApiSurface;
  modelId: string;
  fullModelLines: string[];
  useAlias: boolean;
}): string | null {
  const want = options.modelId;
  const entries = collectParsedCustomModelsDeduped(options.fullModelLines);
  const hit = entries.find(e =>
    options.useAlias ? e.alias === want || e.id === want : e.id === want
  );
  if (!hit) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const openaiEntry: OpenAIModelEntry = {
    id: want,
    object: "model",
    created: now,
    owned_by: "ccrelay",
    ...(hit.displayName !== want ? { display_name: hit.displayName } : {}),
  };
  if (options.clientSurface === "anthropic") {
    return JSON.stringify(convertOpenAISingleModelToAnthropic(openaiEntry));
  }
  return JSON.stringify(openaiEntry);
}

/** JSON error body for synthetic model-not-found (shape matches client surface). */
export function synthesizeModelNotFoundBody(clientSurface: ApiSurface, modelId: string): string {
  if (clientSurface === "anthropic") {
    return JSON.stringify({
      type: "error",
      error: {
        type: "not_found_error",
        message: `Model not found: ${modelId}`,
      },
    });
  }
  return JSON.stringify({
    error: {
      type: "invalid_request_error",
      message: `Model '${modelId}' not found.`,
      param: null,
      code: null,
    },
  });
}
