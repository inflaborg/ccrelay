/**
 * Default outbound transform and shared guards (no imports from glm/xiaomimimo — avoids cycles).
 */

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/** Preserve fields as-is except invalid web_search envelopes. */
export function passthroughTransform(tool: Record<string, unknown>): Record<string, unknown> {
  const typ = typeof tool.type === "string" ? tool.type : "";
  const out: Record<string, unknown> = { ...tool };
  if (typ === "web_search") {
    const envelope = tool.web_search;
    if ("web_search" in out && (envelope === null || !isPlainObject(envelope))) {
      delete out.web_search;
    }
  }
  return out;
}
