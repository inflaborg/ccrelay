/* eslint-disable @typescript-eslint/naming-convention -- YAML snake_case parity */
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
