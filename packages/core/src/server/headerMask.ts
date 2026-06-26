/**
 * Header masking for request-log persistence.
 *
 * Headers may carry secrets (auth tokens). Before storing request/response headers
 * in the log database, sensitive header values are masked: keep the first 4 and
 * last 4 characters, replace the middle with "***". Auth scheme prefixes
 * (`Bearer `, `Basic `) are preserved and only the credential is masked.
 */

/** Header names whose values must be masked before logging (compared case-insensitively). */
export const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "proxy-authorization",
]);

/** Fully masked placeholder for secrets too short to safely show first/last 4. */
const FULL_MASK = "********";

/**
 * Mask a single secret value: keep first 4 + last 4, middle becomes "***".
 * Values of length <= 8 are fully masked (first4+last4 would leak most of a short secret).
 * A leading auth scheme token (`Bearer <token>`, `Basic <token>`) is preserved.
 */
export function maskSecretValue(value: string): string {
  if (value.length <= 8) {
    return FULL_MASK;
  }
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx > 0 && spaceIdx < value.length - 1) {
    const scheme = value.slice(0, spaceIdx + 1);
    const credential = value.slice(spaceIdx + 1);
    if (credential.length <= 8) {
      return `${scheme}${FULL_MASK}`;
    }
    return `${scheme}${credential.slice(0, 4)}***${credential.slice(-4)}`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/**
 * Build a masked, JSON-serializable copy of a header set for log storage.
 * Returns `undefined` when there are no headers (stored as NULL).
 *
 * Accepts both string and string[] values (response headers such as `set-cookie`
 * may be arrays). Sensitive header values are masked; all others pass through.
 */
export function maskHeadersForLog(
  headers: Record<string, string | string[]> | undefined | null
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const keys = Object.keys(headers);
  if (keys.length === 0) {
    return undefined;
  }
  const out: Record<string, string | string[]> = {};
  for (const key of keys) {
    const value = headers[key];
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      out[key] = Array.isArray(value) ? value.map(v => maskSecretValue(v)) : maskSecretValue(value);
    } else {
      out[key] = value;
    }
  }
  return JSON.stringify(out);
}
