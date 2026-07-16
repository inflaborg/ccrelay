const SEARCH_BACKEND_LABELS: Record<string, string> = {
  tavily: "Tavily",
  parallel: "Parallel",
  glm: "GLM",
};

/** Parse service_meta JSON from a log row. */
export function parseLogServiceMeta(meta?: string): Record<string, unknown> | undefined {
  if (!meta?.trim()) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(meta);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Pretty-print service_meta for the detail panel. */
export function formatServiceMetaForDetail(meta?: string): string | undefined {
  const parsed = parseLogServiceMeta(meta);
  if (!parsed) {
    return undefined;
  }
  return JSON.stringify(parsed, null, 2);
}

/** Friendly lines for known handlers in the detail panel. */
export function formatServiceMetaSummary(handler: string | undefined, meta?: string): string[] {
  const parsed = parseLogServiceMeta(meta);
  if (!handler || !parsed) {
    return [];
  }
  if (handler === "web-search" && typeof parsed.searchBackend === "string") {
    const label = SEARCH_BACKEND_LABELS[parsed.searchBackend] ?? parsed.searchBackend;
    return [label];
  }
  return [];
}
