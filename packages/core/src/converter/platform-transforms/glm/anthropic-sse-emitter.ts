/**
 * Parse / serialize Anthropic Messages SSE (`text/event-stream`).
 */

export interface AnthropicSseEventRow {
  /** Optional SSE `event:` name. */
  eventName?: string;
  /** Parsed JSON from `data:` line(s). */
  data: Record<string, unknown>;
}

/**
 * Split a full upstream SSE body into parsed `data:` JSON objects (one per SSE event).
 */
export function parseAnthropicSseRows(raw: string): AnthropicSseEventRow[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  const chunks = normalized.split("\n\n").filter(c => c.trim().length > 0);
  const out: AnthropicSseEventRow[] = [];

  for (const chunk of chunks) {
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      const l = line.trimEnd();
      if (l.startsWith("event:")) {
        eventName = l.slice(6).trimStart();
      } else if (l.startsWith("data:")) {
        dataLines.push(l.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      continue;
    }
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      continue;
    }
    try {
      const data = JSON.parse(payload) as Record<string, unknown>;
      out.push({ eventName, data });
    } catch {
      // ignore corrupt block
    }
  }
  return out;
}

/**
 * Rebuild SSE text. Preserves `event:` when present on the row.
 */
export function serializeAnthropicSseRows(rows: AnthropicSseEventRow[]): string {
  const parts: string[] = [];
  for (const row of rows) {
    const payload = JSON.stringify(row.data);
    if (row.eventName !== undefined && row.eventName.length > 0) {
      parts.push(`event: ${row.eventName}\ndata: ${payload}\n\n`);
    } else {
      parts.push(`data: ${payload}\n\n`);
    }
  }
  return parts.join("");
}
