/**
 * Driver-agnostic utilities for request log storage and row mapping.
 */

import type { RequestLog } from "./types";

export const MAX_LOG_ROWS = 10000;
export const MAX_LOG_AGE_DAYS = 30;

/** List-view prefix of request bodies for model extraction (Chat bodies often place `model` after long `messages`). */
export const LIST_LOG_MODEL_BODY_HEAD_BYTES = 32_768;
/** List-view suffix when the body exceeds the head prefix (late `model` field). */
export const LIST_LOG_MODEL_BODY_TAIL_BYTES = 8_192;

/** Serialize handler metadata for DB storage; empty object → NULL. */
export function serializeServiceMeta(meta?: Record<string, unknown>): string | undefined {
  if (!meta) {
    return undefined;
  }
  const keys = Object.keys(meta);
  if (keys.length === 0) {
    return undefined;
  }
  return JSON.stringify(meta);
}

/** Parse service_meta column from DB. */
export function parseServiceMetaColumn(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** SQLite SELECT fragments for list-view model extraction from BLOB bodies. */
export function sqliteListBodyPreviewColumns(tableAlias = "v"): string {
  const head = LIST_LOG_MODEL_BODY_HEAD_BYTES;
  const tail = LIST_LOG_MODEL_BODY_TAIL_BYTES;
  return `
    SUBSTR(${tableAlias}.request_body, 1, ${head}) as request_body,
    SUBSTR(${tableAlias}.original_request_body, 1, ${head}) as original_request_body,
    CASE WHEN length(${tableAlias}.request_body) > ${head}
      THEN SUBSTR(${tableAlias}.request_body, -${tail}) ELSE NULL END as request_body_tail,
    CASE WHEN length(${tableAlias}.original_request_body) > ${head}
      THEN SUBSTR(${tableAlias}.original_request_body, -${tail}) ELSE NULL END as original_request_body_tail`;
}

/** Legacy on-disk prefix for TEXT columns (import only). */
const BASE64_PREFIX = "B64:";

export function decodeFromStorage(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith(BASE64_PREFIX)) {
    try {
      return Buffer.from(value.slice(BASE64_PREFIX.length), "base64").toString("utf-8");
    } catch {
      return value;
    }
  }
  return value;
}

export function utf8StringToBlob(value: string | undefined): Buffer | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Buffer.from(value, "utf-8");
}

export function blobToUtf8String(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Buffer.isBuffer(value)) {
    return value.length > 0 ? value.toString("utf-8") : undefined;
  }
  if (value instanceof Uint8Array) {
    return value.length > 0 ? Buffer.from(value).toString("utf-8") : undefined;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/**
 * Extract model name from a JSON body that may be truncated.
 */
export function extractModelFromPartialJson(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { model?: string; data?: { model?: string } };
    return (typeof parsed.model === "string" && parsed.model) || parsed.data?.model || undefined;
  } catch {
    const matches = [...body.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
    if (matches.length === 0) {
      return undefined;
    }
    // Chat Completions often places `model` after a large `messages` array; prefer the last match.
    return matches[matches.length - 1][1];
  }
}

function bodyPreviewForModelExtract(
  row: Record<string, unknown>,
  headKey: string,
  tailKey: string
): string | undefined {
  const head = bodyFieldToString(row[headKey]);
  const tail = bodyFieldToString(row[tailKey]);
  if (!head && !tail) {
    return undefined;
  }
  if (!tail) {
    return head;
  }
  if (!head) {
    return tail;
  }
  if (head.includes('"model"')) {
    return head;
  }
  return head + tail;
}

function bodyFieldToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return blobToUtf8String(raw);
  }
  if (typeof raw === "string") {
    return decodeFromStorage(raw) ?? (raw.length > 0 ? raw : undefined);
  }
  return undefined;
}

/**
 * Read a masked-JSON header column (TEXT). Stored as a plain string; Buffer is
 * handled defensively. Empty/missing values collapse to undefined.
 */
function headerFieldToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return blobToUtf8String(raw);
  }
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : undefined;
  }
  return undefined;
}

/**
 * Populate model/mappedModel from stored bodies.
 */
export function extractModelsFromBodies(
  row: Record<string, unknown>
): Pick<RequestLog, "model" | "mappedModel"> {
  const result: Pick<RequestLog, "model" | "mappedModel"> = {};

  const originalBody = bodyPreviewForModelExtract(
    row,
    "original_request_body",
    "original_request_body_tail"
  );
  if (originalBody) {
    result.model = extractModelFromPartialJson(originalBody);
  }

  const requestBody = bodyPreviewForModelExtract(row, "request_body", "request_body_tail");
  if (requestBody) {
    const model = extractModelFromPartialJson(requestBody);
    if (model) {
      result.mappedModel = model;
      if (!result.model) {
        result.model = model;
      }
    }
  }

  if (!result.mappedModel && typeof row.metrics_model === "string" && row.metrics_model) {
    result.mappedModel = row.metrics_model;
    if (!result.model) {
      result.model = row.metrics_model;
    }
  }

  if (!result.model) {
    const p = (row.path as string) || "";
    const pathMatch = p.match(/\/models\/([^\/\?]+)/);
    if (pathMatch) {
      result.model = pathMatch[1];
    }
  }

  return result;
}

/**
 * Convert a database row to RequestLog (without body fields for list view).
 */
export function dbRowToLogWithoutBody(row: Record<string, unknown>): RequestLog {
  const models = extractModelsFromBodies(row);
  const log: RequestLog = {
    id: row.id as number,
    timestamp: row.timestamp as number,
    providerId: row.provider_id as string,
    providerName: row.provider_name as string,
    method: row.method as string,
    path: row.path as string,
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: (row.error_message as string | undefined) ?? undefined,
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
    serviceHandler: (row.service_handler as string | undefined) ?? undefined,
    serviceMeta: parseServiceMetaColumn(row.service_meta),
    inputTokens: row.input_tokens as number | undefined,
    outputTokens: row.output_tokens as number | undefined,
    cacheTokens: row.cache_tokens as number | undefined,
    ttfb: row.ttfb as number | undefined,
    queueWaitMs: row.queue_wait_ms as number | undefined,
    upstreamTtfbMs: row.upstream_ttfb_ms as number | undefined,
    genMs: row.gen_ms as number | undefined,
    totalMs: row.total_ms as number | undefined,
    ...models,
  };

  if (!log.model) {
    const pathMatch = log.path.match(/\/models\/([^\/\?]+)/);
    if (pathMatch) {
      log.model = pathMatch[1];
    }
  }

  return log;
}

/**
 * Convert database row to RequestLog (with body fields for detail view).
 */
export function dbRowToLog(row: Record<string, unknown>): RequestLog {
  const models = extractModelsFromBodies(row);
  return {
    id: row.id as number,
    timestamp: row.timestamp as number,
    providerId: row.provider_id as string,
    providerName: row.provider_name as string,
    method: row.method as string,
    path: row.path as string,
    targetUrl: row.target_url as string | undefined,
    requestBody: bodyFieldToString(row.request_body),
    responseBody: bodyFieldToString(row.response_body),
    originalRequestBody: bodyFieldToString(row.original_request_body),
    originalResponseBody: bodyFieldToString(row.original_response_body),
    requestHeaders: headerFieldToString(row.request_headers),
    responseHeaders: headerFieldToString(row.response_headers),
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: (row.error_message as string | undefined) ?? undefined,
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
    serviceHandler: (row.service_handler as string | undefined) ?? undefined,
    serviceMeta: parseServiceMetaColumn(row.service_meta),
    inputTokens: row.input_tokens as number | undefined,
    outputTokens: row.output_tokens as number | undefined,
    cacheTokens: row.cache_tokens as number | undefined,
    ttfb: row.ttfb as number | undefined,
    queueWaitMs: row.queue_wait_ms as number | undefined,
    upstreamTtfbMs: row.upstream_ttfb_ms as number | undefined,
    genMs: row.gen_ms as number | undefined,
    totalMs: row.total_ms as number | undefined,
    ...models,
  };
}

/** Omit per-provider breakdown rows with no token usage (Input, Output, Cache all zero). */
export function filterProviderBreakdownByTokenUsage<
  T extends {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheTokens: number;
  },
>(rows: T[]): T[] {
  return rows.filter(
    row => row.totalInputTokens > 0 || row.totalOutputTokens > 0 || row.totalCacheTokens > 0
  );
}
