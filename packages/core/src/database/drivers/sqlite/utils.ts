/**
 * SQLite-specific utilities shared by SqliteCliDriver and SqliteNativeDriver.
 */

import { TABLE } from "../../schema";
import type { RequestLog } from "../../types";
import { utf8StringToBlob } from "../../shared-utils";
import { decodeBlobFromCliWire } from "./cli-wire";

export type SqlInsertParam = string | number | boolean | Buffer | null;

/**
 * Build an INSERT SQL statement for a RequestLog (v2 BLOB columns).
 */
export function buildInsertSql(
  log: RequestLog,
  status: string = "completed"
): {
  sql: string;
  params: SqlInsertParam[];
} {
  return {
    sql: `INSERT INTO ${TABLE} (
      timestamp, provider_id, provider_name, method, path, target_url,
      request_body, response_body, original_request_body, original_response_body,
      status_code, duration, success, error_message, client_id, status, route_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      log.timestamp,
      log.providerId,
      log.providerName,
      log.method,
      log.path,
      log.targetUrl ?? null,
      utf8StringToBlob(log.requestBody),
      utf8StringToBlob(log.responseBody),
      utf8StringToBlob(log.originalRequestBody),
      utf8StringToBlob(log.originalResponseBody),
      log.statusCode ?? null,
      log.duration,
      log.success ? 1 : 0,
      log.errorMessage ?? null,
      log.clientId ?? null,
      status,
      log.routeType ?? null,
    ],
  };
}

/**
 * SQL fragment for list-view body previews over the CLI pipe.
 * hex(SUBSTR(blob)) yields pipe-safe strings (no JSON brackets), like V1 base64 TEXT.
 */
export const CLI_BODY_PREVIEW_HEX = `
  hex(SUBSTR(request_body, 1, 500)) as request_body,
  hex(SUBSTR(original_request_body, 1, 500)) as original_request_body`;

/** Decode hex wire from sqlite3 -json; fallback to legacy base64/B64: wire formats. */
function decodeHexBlob(value: unknown): Buffer | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^[0-9A-Fa-f]*$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, "hex");
  }
  return decodeBlobFromCliWire(trimmed);
}

/** Normalize CLI query rows: decode BLOB columns from wire/json representation. */
export function normalizeCliRow(row: Record<string, unknown>): Record<string, unknown> {
  const blobCols = [
    "request_body",
    "response_body",
    "original_request_body",
    "original_response_body",
  ] as const;
  const out = { ...row };
  for (const col of blobCols) {
    if (!(col in out)) {
      continue;
    }
    out[col] = decodeHexBlob(out[col]);
  }
  return out;
}
