/**
 * Wire encoding for BLOB values sent through the sqlite3 CLI stdin/stdout pipe.
 * Not used for on-disk storage (v2 tables store raw BLOB bytes).
 */

const WIRE_B64_PREFIX = "B64:";

/** Encode a BLOB for safe embedding in interpolated SQL sent over the CLI pipe. */
export function encodeBlobForCliWire(buf: Buffer): string {
  return `${WIRE_B64_PREFIX}${buf.toString("base64")}`;
}

/** SQL literal for a BLOB parameter (hex blob literal). */
export function sqlLiteralForBlob(buf: Buffer): string {
  return `x'${buf.toString("hex")}'`;
}

/**
 * Decode a BLOB field from a sqlite3 JSON query row.
 * Handles base64 strings (sqlite JSON mode), hex, B64: wire prefix, and Buffer.
 */
export function decodeBlobFromCliWire(value: unknown): Buffer | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith(WIRE_B64_PREFIX)) {
    try {
      return Buffer.from(trimmed.slice(WIRE_B64_PREFIX.length), "base64");
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length > 0) {
        return decoded;
      }
    } catch {
      // fall through
    }
  }
  if (trimmed.startsWith("x'") && trimmed.endsWith("'")) {
    try {
      return Buffer.from(trimmed.slice(2, -1), "hex");
    } catch {
      return null;
    }
  }
  return Buffer.from(trimmed, "utf-8");
}
