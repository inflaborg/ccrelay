/**
 * Shared SQL builders for request_metrics table (SQLite + Postgres drivers).
 */

import { METRICS_TABLE } from "./schema";
import {
  STREAM_GEN_SQL_COND,
  STREAM_PERF_SQL_COND,
  TOTAL_MS_SQL_COND,
  UPSTREAM_TTFB_SQL_COND,
} from "./stream-metrics";
import type { RequestLog } from "./types";
import { isTokenUsageRequestPath } from "../converter/paths";

/** Re-export for drivers building stats queries. */
export { STREAM_PERF_SQL_COND, STREAM_GEN_SQL_COND, UPSTREAM_TTFB_SQL_COND, TOTAL_MS_SQL_COND };

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
      input_tokens, output_tokens, cache_tokens, ttfb, duration,
      queue_wait_ms, upstream_ttfb_ms, gen_ms, total_ms,
      success, status_code
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
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
      input_tokens, output_tokens, cache_tokens, ttfb, duration,
      queue_wait_ms, upstream_ttfb_ms, gen_ms, total_ms,
      success, status_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      input_tokens=excluded.input_tokens,
      output_tokens=excluded.output_tokens,
      cache_tokens=excluded.cache_tokens,
      ttfb=excluded.ttfb,
      duration=excluded.duration,
      queue_wait_ms=excluded.queue_wait_ms,
      upstream_ttfb_ms=excluded.upstream_ttfb_ms,
      gen_ms=excluded.gen_ms,
      total_ms=excluded.total_ms,
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
      log.queueWaitMs ?? null,
      log.upstreamTtfbMs ?? null,
      log.genMs ?? null,
      log.totalMs ?? null,
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
      queue_wait_ms = ?,
      upstream_ttfb_ms = ?,
      gen_ms = ?,
      total_ms = ?,
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
      queue_wait_ms = $6,
      upstream_ttfb_ms = $7,
      gen_ms = $8,
      total_ms = $9,
      success = $10,
      status_code = $11
  WHERE client_id = $12`;

export const POSTGRES_UPDATE_METRICS_STATUS = `UPDATE ${METRICS_TABLE}
  SET duration = $1,
      success = $2,
      status_code = $3
  WHERE client_id = $4`;
