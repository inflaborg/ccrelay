/**
 * Shared SQL builders for request_metrics table (SQLite + Postgres drivers).
 */

import { METRICS_TABLE } from "./schema";
import type { RequestLog } from "./types";
import { isTokenUsageRequestPath } from "../converter/paths";

export function shouldTrackMetrics(log: Pick<RequestLog, "method" | "path">): boolean {
  return isTokenUsageRequestPath(log.method, log.path);
}

/** SQLite: INSERT metrics row at pending (dimensions + model, tokens null). */
export function buildMetricsPendingInsertSql(log: RequestLog): {
  sql: string;
  params: (string | number | null)[];
} {
  return {
    sql: `INSERT INTO ${METRICS_TABLE} (
      timestamp, provider_id, provider_name, model, client_id,
      input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    params: [
      log.timestamp,
      log.providerId,
      log.providerName,
      log.model ?? null,
      log.clientId ?? null,
    ],
  };
}

/** SQLite: INSERT completed metrics row (insertLog / writeBatch). */
export function buildMetricsCompletedInsertSql(log: RequestLog): {
  sql: string;
  params: (string | number | null)[];
} {
  return {
    sql: `INSERT INTO ${METRICS_TABLE} (
      timestamp, provider_id, provider_name, model, client_id,
      input_tokens, output_tokens, cache_tokens, ttfb, duration, success, status_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      input_tokens=excluded.input_tokens,
      output_tokens=excluded.output_tokens,
      cache_tokens=excluded.cache_tokens,
      ttfb=excluded.ttfb,
      duration=excluded.duration,
      success=excluded.success,
      status_code=excluded.status_code`,
    params: [
      log.timestamp,
      log.providerId,
      log.providerName,
      log.model ?? null,
      log.clientId ?? null,
      log.inputTokens ?? null,
      log.outputTokens ?? null,
      log.cacheTokens ?? null,
      log.ttfb ?? null,
      log.duration,
      log.success ? 1 : 0,
      log.statusCode ?? null,
    ],
  };
}

export const SQLITE_UPDATE_METRICS_COMPLETED = `UPDATE ${METRICS_TABLE}
  SET input_tokens = ?,
      output_tokens = ?,
      cache_tokens = ?,
      ttfb = ?,
      duration = ?,
      success = ?,
      status_code = ?
  WHERE client_id = ?`;

export const SQLITE_UPDATE_METRICS_STATUS = `UPDATE ${METRICS_TABLE}
  SET duration = ?,
      success = ?,
      status_code = ?
  WHERE client_id = ?`;

/** Postgres placeholders for completed metrics update. */
export const POSTGRES_UPDATE_METRICS_COMPLETED = `UPDATE ${METRICS_TABLE}
  SET input_tokens = $1,
      output_tokens = $2,
      cache_tokens = $3,
      ttfb = $4,
      duration = $5,
      success = $6,
      status_code = $7
  WHERE client_id = $8`;

export const POSTGRES_UPDATE_METRICS_STATUS = `UPDATE ${METRICS_TABLE}
  SET duration = $1,
      success = $2,
      status_code = $3
  WHERE client_id = $4`;
