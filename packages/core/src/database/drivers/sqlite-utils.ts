/**
 * Shared SQLite utilities used by both SqliteCliDriver and SqliteNativeDriver.
 */

import type { RequestLog } from "../types";

export const MAX_LOG_ROWS = 10000;
export const MAX_LOG_AGE_DAYS = 30;

/**
 * Base64 encoding helpers for storage.
 * Uses a prefix to distinguish encoded data from legacy plain text.
 */
const BASE64_PREFIX = "B64:";

export function encodeForStorage(value: string | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return BASE64_PREFIX + Buffer.from(value, "utf-8").toString("base64");
}

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

/**
 * Build an INSERT SQL statement for a RequestLog.
 * Returns the SQL template and parameter array for use with prepared statements.
 */
export function buildInsertSql(
  log: RequestLog,
  status: string = "completed"
): {
  sql: string;
  params: (string | number | boolean | null | undefined)[];
} {
  return {
    sql: `INSERT INTO request_logs (
      timestamp, provider_id, provider_name, method, path, target_url,
      request_body, response_body, original_request_body, original_response_body,
      status_code, duration, success, error_message, client_id, status, route_type,
      input_tokens, output_tokens, cache_tokens, ttfb
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      log.timestamp,
      log.providerId,
      log.providerName,
      log.method,
      log.path,
      log.targetUrl ?? null,
      encodeForStorage(log.requestBody),
      encodeForStorage(log.responseBody),
      encodeForStorage(log.originalRequestBody),
      encodeForStorage(log.originalResponseBody),
      log.statusCode ?? null,
      log.duration,
      log.success ? 1 : 0,
      encodeForStorage(log.errorMessage),
      log.clientId ?? null,
      status,
      log.routeType ?? null,
      log.inputTokens ?? null,
      log.outputTokens ?? null,
      log.cacheTokens ?? null,
      log.ttfb ?? null,
    ],
  };
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

/**
 * Populate model/mappedModel from stored bodies.
 */
export function extractModelsFromBodies(
  row: Record<string, unknown>
): Pick<RequestLog, "model" | "mappedModel"> {
  const result: Pick<RequestLog, "model" | "mappedModel"> = {};

  const rawOriginalBody = row.original_request_body as string | undefined;
  if (rawOriginalBody) {
    const originalBody = decodeFromStorage(rawOriginalBody);
    if (originalBody) {
      result.model = extractModelFromPartialJson(originalBody);
    }
  }

  const rawRequestBody = row.request_body as string | undefined;
  if (rawRequestBody) {
    const requestBody = decodeFromStorage(rawRequestBody);
    if (requestBody) {
      const model = extractModelFromPartialJson(requestBody);
      if (model) {
        result.mappedModel = model;
        if (!result.model) {
          result.model = model;
        }
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
    errorMessage: row.error_message as string | undefined,
    clientId: row.client_id as string | undefined,
    status: row.status as RequestLog["status"],
    routeType: row.route_type as RequestLog["routeType"],
    inputTokens: row.input_tokens as number | undefined,
    outputTokens: row.output_tokens as number | undefined,
    cacheTokens: row.cache_tokens as number | undefined,
    ttfb: row.ttfb as number | undefined,
  };

  if (log.errorMessage) {
    log.errorMessage = decodeFromStorage(log.errorMessage);
  }

  const rawOriginalBody = row.original_request_body as string | undefined;
  if (rawOriginalBody) {
    const originalBody = decodeFromStorage(rawOriginalBody);
    if (originalBody) {
      log.model = extractModelFromPartialJson(originalBody);
    }
  }

  const rawRequestBody = row.request_body as string | undefined;
  if (rawRequestBody) {
    const requestBody = decodeFromStorage(rawRequestBody);
    if (requestBody) {
      const model = extractModelFromPartialJson(requestBody);
      if (model) {
        log.mappedModel = model;
        if (!log.model) {
          log.model = model;
        }
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
    requestBody: decodeFromStorage(row.request_body as string | undefined),
    responseBody: decodeFromStorage(row.response_body as string | undefined),
    originalRequestBody: decodeFromStorage(row.original_request_body as string | undefined),
    originalResponseBody: decodeFromStorage(row.original_response_body as string | undefined),
    statusCode: row.status_code as number | undefined,
    duration: row.duration as number,
    success: (row.success as number) !== 0,
    errorMessage: decodeFromStorage(row.error_message as string | undefined),
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
