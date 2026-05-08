/**
 * Buffer-friendly Anthropic Messages SSE rewriter: GLM `web_search_prime` + textual `tool_result`
 * payloads become `server_tool_use` (`web_search`) + `web_search_tool_result`.
 */

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic / GLM SSE wire payloads */

import type { AnthropicSseEventRow } from "./anthropic-sse-emitter";

import type { GlmWebSearchEntry } from "./types";

/** GLM nests hits as `[[{ title, link, content, refer }, ...]]` inside the tool_result string. */
export function parseGlmToolResultAsSearchEntries(raw: string): GlmWebSearchEntry[] | null {
  const s = raw.trim();
  if (!s) {
    return null;
  }
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const inner: unknown = parsed[0];
    if (!Array.isArray(inner)) {
      return null;
    }
    if (!inner.every(x => x && typeof x === "object" && !Array.isArray(x))) {
      return null;
    }
    return inner as GlmWebSearchEntry[];
  } catch {
    return null;
  }
}

function webSearchStructuredResults(entries: GlmWebSearchEntry[]): Record<string, unknown>[] {
  return entries.map(entry => ({
    type: "web_search_result",
    url: typeof entry.link === "string" ? entry.link : "",
    title: typeof entry.title === "string" ? entry.title : "",
    ...(typeof entry.content === "string" && entry.content.length > 0
      ? { encrypted_content: entry.content }
      : {}),
  }));
}

export function glmWebSearchServerToolName(name: unknown): boolean {
  return typeof name === "string" && name.includes("web_search");
}

function collectToolResultString(
  rows: AnthropicSseEventRow[],
  start: number,
  blockIndex: unknown
): { stopIndex: number; merged: string } | null {
  const cbStart = rows[start].data.content_block as Record<string, unknown> | undefined;
  const fragments: string[] = [];
  const initial = cbStart?.content;
  if (typeof initial === "string" && initial.length > 0) {
    fragments.push(initial);
  }
  let j = start + 1;
  while (j < rows.length) {
    const rj = rows[j];
    const tj = rj.data.type;
    if (tj === "content_block_delta" && rj.data.index === blockIndex) {
      const delta = rj.data.delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.content === "string") {
        fragments.push(delta.content);
      }
      j++;
      continue;
    }
    if (tj === "content_block_stop" && rj.data.index === blockIndex) {
      return { stopIndex: j, merged: fragments.join("") };
    }
    break;
  }
  return null;
}

/**
 * GLM often injects prose in `text_delta` / `thinking_delta` that still says `web_search_prime`
 * while we normalize structured blocks to `web_search`; clients then see mixed naming.
 */
function sanitizeGlmWebSearchPrimeEchoesInDeltaRows(
  rows: AnthropicSseEventRow[]
): AnthropicSseEventRow[] {
  return rows.map(row => {
    if (row.data.type !== "content_block_delta") {
      return structuredCloneRow(row);
    }
    const delta = row.data.delta as Record<string, unknown> | undefined;
    if (!delta) {
      return structuredCloneRow(row);
    }
    const dt = typeof delta.type === "string" ? delta.type : "";
    let key: "text" | "thinking" | null = null;
    if (dt === "text_delta") {
      key = "text";
    } else if (dt === "thinking_delta") {
      key = "thinking";
    }
    if (!key) {
      return structuredCloneRow(row);
    }
    const val = delta[key];
    if (typeof val !== "string" || !val.includes("web_search_prime")) {
      return structuredCloneRow(row);
    }
    const data = structuredClone(row.data);
    data.delta = {
      ...delta,
      [key]: val
        .replace(/web_search_prime_result_summary/g, "web_search_result_summary")
        .replace(/web_search_prime/g, "web_search"),
    };
    return { eventName: row.eventName, data };
  });
}

/**
 * Rewrite GLM-hosted search SSE: normalize `server_tool_use.name` → `web_search` and collapse
 * textual `tool_result` JSON into structured `web_search_tool_result`.
 */
export function transformGlmAnthropicSearchSseRows(
  rows: AnthropicSseEventRow[]
): AnthropicSseEventRow[] {
  let i = 0;
  const out: AnthropicSseEventRow[] = [];

  while (i < rows.length) {
    const row = rows[i];
    const top = row.data.type;

    if (top === "content_block_start") {
      const cb = row.data.content_block as Record<string, unknown> | undefined;
      if (!cb) {
        out.push(structuredCloneRow(row));
        i++;
        continue;
      }
      const btype = typeof cb.type === "string" ? cb.type : "";

      if (btype === "server_tool_use" && glmWebSearchServerToolName(cb.name)) {
        const data = structuredClone(row.data);
        const cbc = { ...(data.content_block as Record<string, unknown>) };
        cbc.name = "web_search";
        data.content_block = cbc;
        out.push({ eventName: row.eventName, data });
        i++;
        continue;
      }

      if (btype === "tool_result") {
        const pair = collectToolResultString(rows, i, row.data.index);
        if (!pair) {
          out.push(structuredCloneRow(row));
          i++;
          continue;
        }

        const { stopIndex, merged } = pair;
        const toolUseId = typeof cb.tool_use_id === "string" ? cb.tool_use_id : "";
        const hits = parseGlmToolResultAsSearchEntries(merged);

        if (!hits || hits.length === 0 || !toolUseId) {
          for (let k = i; k <= stopIndex; k++) {
            out.push(structuredCloneRow(rows[k]));
          }
          i = stopIndex + 1;
          continue;
        }

        const blockIdx = row.data.index;
        out.push({
          eventName: row.eventName,
          data: {
            type: "content_block_start",
            index: blockIdx,
            content_block: {
              type: "web_search_tool_result",
              tool_use_id: toolUseId,
              content: webSearchStructuredResults(hits),
            },
          },
        });
        const stopRow = rows[stopIndex];
        out.push({
          eventName: stopRow.eventName,
          data: {
            type: "content_block_stop",
            index: blockIdx,
          },
        });

        i = stopIndex + 1;
        continue;
      }
    }

    out.push(structuredCloneRow(row));
    i++;
  }

  return sanitizeGlmWebSearchPrimeEchoesInDeltaRows(out);
}

function structuredCloneRow(row: AnthropicSseEventRow): AnthropicSseEventRow {
  return {
    eventName: row.eventName,
    data: structuredClone(row.data),
  };
}
