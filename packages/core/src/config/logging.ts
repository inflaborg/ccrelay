/* eslint-disable @typescript-eslint/naming-convention -- YAML snake_case parity */
import { DEFAULT_LOG_RETENTION, type LogRetentionPolicy } from "../database/types";
import { DEFAULT_LOG_MAX_BODY_BYTES } from "../database/shared-utils";

/** Bundled default: store request/response bodies in the Logs tab. */
export const DEFAULT_LOGGING_STORE_BODIES = true;

/**
 * Resolve whether request/response bodies should be stored.
 * `storeBodies` / `store_bodies` wins; otherwise fall back to deprecated `enabled`; else default on.
 */
export function resolveLoggingStoreBodies(
  logging:
    | {
        storeBodies?: boolean;
        store_bodies?: boolean;
        enabled?: boolean;
      }
    | undefined
): boolean {
  if (!logging) {
    return DEFAULT_LOGGING_STORE_BODIES;
  }
  if (typeof logging.storeBodies === "boolean") {
    return logging.storeBodies;
  }
  if (typeof logging.store_bodies === "boolean") {
    return logging.store_bodies;
  }
  if (typeof logging.enabled === "boolean") {
    return logging.enabled;
  }
  return DEFAULT_LOGGING_STORE_BODIES;
}

function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Resolve `logging.retention`; missing or invalid limits fall back to the defaults. */
export function resolveLogRetention(
  logging: { retention?: Partial<Record<keyof LogRetentionPolicy, unknown>> } | undefined
): LogRetentionPolicy {
  const r = logging?.retention;
  return {
    maxAgeDays: nonNegativeOr(r?.maxAgeDays, DEFAULT_LOG_RETENTION.maxAgeDays),
    maxRows: Math.floor(nonNegativeOr(r?.maxRows, DEFAULT_LOG_RETENTION.maxRows)),
    maxSizeMB: nonNegativeOr(r?.maxSizeMB, DEFAULT_LOG_RETENTION.maxSizeMB),
  };
}

/** Resolve `logging.maxBodyBytes`; 0 = unlimited. */
export function resolveLogMaxBodyBytes(logging: { maxBodyBytes?: unknown } | undefined): number {
  return Math.floor(nonNegativeOr(logging?.maxBodyBytes, DEFAULT_LOG_MAX_BODY_BYTES));
}
