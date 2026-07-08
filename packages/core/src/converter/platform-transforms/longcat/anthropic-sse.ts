/**
 * LongCat Anthropic Messages SSE: `message_start` often ships `usage: {}` while strict
 * clients require numeric `input_tokens` / `output_tokens` (final counts arrive on `message_delta`).
 */

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic SSE wire payloads */

import type { AnthropicSseEventRow } from "../glm/anthropic-sse-emitter";

function defaultUsageNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMessageStartUsage(row: AnthropicSseEventRow): AnthropicSseEventRow {
  if (row.data.type !== "message_start") {
    return row;
  }

  const message = row.data.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return row;
  }

  const msg = message as Record<string, unknown>;
  const usageRaw = msg.usage;
  const usage =
    usageRaw && typeof usageRaw === "object" && !Array.isArray(usageRaw)
      ? (usageRaw as Record<string, unknown>)
      : {};

  const data = structuredClone(row.data);
  const normalizedMessage = { ...(data.message as Record<string, unknown>) };
  normalizedMessage.usage = {
    input_tokens: defaultUsageNumber(usage.input_tokens),
    output_tokens: defaultUsageNumber(usage.output_tokens),
    cache_read_input_tokens: defaultUsageNumber(usage.cache_read_input_tokens),
    cache_creation_input_tokens: defaultUsageNumber(usage.cache_creation_input_tokens),
  };
  data.message = normalizedMessage;

  return { eventName: row.eventName, data };
}

/** Fill missing numeric usage fields on `message_start` for strict Anthropic SSE clients. */
export function transformLongcatAnthropicSseRows(
  rows: AnthropicSseEventRow[]
): AnthropicSseEventRow[] {
  return rows.map(normalizeMessageStartUsage);
}
