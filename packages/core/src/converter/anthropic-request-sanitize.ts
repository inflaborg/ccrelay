/**
 * Strip Claude/Cowork-injected billing header blocks from Anthropic request bodies.
 * These volatile system blocks break prompt caching prefixes when cc_version/cch change.
 */

import { sanitizeAnthropicRequestRecord } from "./model-meta/sanitize-anthropic";

/** Entire block must be a `key=value;` sequence — no trailing real prompt content. */
const BILLING_HEADER_FULL_RE = /^x-anthropic-billing-header:\s*(?:[a-z0-9_]+\s*=\s*[^;]*;\s*)+$/i;

export function isBillingHeaderBlock(text: unknown): boolean {
  if (typeof text !== "string") {
    return false;
  }
  const t = text.trim();
  if (!BILLING_HEADER_FULL_RE.test(t)) {
    return false;
  }
  return /\bcc_version\s*=/i.test(t) || /\bcch\s*=/i.test(t);
}

function isBillingHeaderSystemBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const b = block as Record<string, unknown>;
  if (b.type !== "text") {
    return false;
  }
  return isBillingHeaderBlock(b.text);
}

/**
 * Remove pure billing-header system blocks from an Anthropic Messages API body.
 * Returns the original buffer when nothing changes.
 */
export function stripBillingHeaderFromAnthropicBody(body: Buffer): Buffer {
  if (!body || body.length === 0) {
    return body;
  }

  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.toString("utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return body;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    return body;
  }

  const system = data.system;
  if (system === undefined) {
    return body;
  }

  let changed = false;

  if (Array.isArray(system)) {
    const filtered = system.filter(block => {
      if (isBillingHeaderSystemBlock(block)) {
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) {
      if (filtered.length === 0) {
        delete data.system;
      } else {
        data.system = filtered;
      }
    }
  } else if (typeof system === "string" && isBillingHeaderBlock(system)) {
    delete data.system;
    changed = true;
  }

  if (!changed) {
    return body;
  }

  return Buffer.from(JSON.stringify(data), "utf-8");
}

function sanitizeAnthropicRecordInPlace(data: Record<string, unknown>): boolean {
  const before = JSON.stringify(data);
  sanitizeAnthropicRequestRecord(data);
  return JSON.stringify(data) !== before;
}

/**
 * Billing-header strip + model-capability sanitize for outbound Anthropic Messages bodies.
 * Returns the original buffer when nothing changes.
 */
export function sanitizeAnthropicOutboundBody(body: Buffer): Buffer {
  let next = stripBillingHeaderFromAnthropicBody(body);
  if (!next || next.length === 0) {
    return next;
  }

  try {
    const parsed: unknown = JSON.parse(next.toString("utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return next;
    }
    const data = parsed as Record<string, unknown>;
    if (sanitizeAnthropicRecordInPlace(data)) {
      next = Buffer.from(JSON.stringify(data), "utf-8");
    }
  } catch {
    return next;
  }

  return next;
}
