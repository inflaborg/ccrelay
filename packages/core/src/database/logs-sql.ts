/**
 * Shared SQL for request_logs_v2 token redundancy (SQLite + Postgres drivers).
 */

import { TABLE } from "./schema";

export const SQLITE_UPDATE_LOG_COMPLETED = `UPDATE ${TABLE}
  SET status_code = ?,
      response_body = ?,
      original_response_body = ?,
      duration = ?,
      success = ?,
      error_message = ?,
      response_headers = ?,
      input_tokens = ?,
      output_tokens = ?,
      cache_tokens = ?,
      ttfb = ?,
      queue_wait_ms = ?,
      upstream_ttfb_ms = ?,
      gen_ms = ?,
      total_ms = ?,
      status = 'completed'
  WHERE client_id = ?`;

export const POSTGRES_UPDATE_LOG_COMPLETED = `UPDATE ${TABLE}
  SET status_code = $1,
      response_body = $2,
      original_response_body = $3,
      duration = $4,
      success = $5,
      error_message = $6,
      response_headers = $7,
      input_tokens = $8,
      output_tokens = $9,
      cache_tokens = $10,
      ttfb = $11,
      queue_wait_ms = $12,
      upstream_ttfb_ms = $13,
      gen_ms = $14,
      total_ms = $15,
      status = 'completed'
  WHERE client_id = $16`;
