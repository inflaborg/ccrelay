/**
 * Driver-agnostic utilities for request log storage and row mapping.
 */

import type { RequestLog } from "./types";

export const MAX_LOG_ROWS = 10000;
export const MAX_LOG_AGE_DAYS = 30;

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
    const match = body.match(/"model"\s*:\s*"([^"]+)"/);
    return match?.[1];
  }
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
 * Populate model/mappedModel from stored bodies.
 */
export function extractModelsFromBodies(
  row: Record<string, unknown>
): Pick<RequestLog, "model" | "mappedModel"> {
  const result: Pick<RequestLog, "model" | "mappedModel"> = {};

  const originalBody = bodyFieldToString(row.original_request_body);
  if (originalBody) {
    result.model = extractModelFromPartialJson(originalBody);
  }

  const requestBody = bodyFieldToString(row.request_body);
  if (requestBody) {
    const model = extractModelFromPartialJson(requestBody);
    if (model) {
      result.mappedModel = model;
      if (!result.model) {
        result.model = model;
      }
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
    inputTokens: row.input_tokens as number | undefined,
    outputTokens: row.output_tokens as number | undefined,
    cacheTokens: row.cache_tokens as number | undefined,
    ttfb: row.ttfb as number | undefined,
  };

  const originalBody = bodyFieldToString(row.original_request_body);
  if (originalBody) {
    log.model = extractModelFromPartialJson(originalBody);
  }

  const requestBody = bodyFieldToString(row.request_body);
  if (requestBody) {
    const model = extractModelFromPartialJson(requestBody);
    if (model) {
      log.mappedModel = model;
      if (!log.model) {
        log.model = model;
      }
    }
  }

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
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: (row.error_message as string | undefined) ?? undefined,
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
    inputTokens: row.input_tokens as number | undefined,
    outputTokens: row.output_tokens as number | undefined,
    cacheTokens: row.cache_tokens as number | undefined,
    ttfb: row.ttfb as number | undefined,
    ...models,
  };
}
