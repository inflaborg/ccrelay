/**
 * GLM / Z.ai OpenAI-chat `web_search`: nested `web_search` object cannot be absent or null upstream.
 * "Web Search in Chat" only returns real retrieval when `search_engine` and `search_result` are set
 * (see Z.AI guides); `{ enable, max_uses }` alone is accepted but does not populate response `web_search`.
 *
 * Z.ai examples nest options under `web_search`; flat keys on the tool entry are hoisted into that
 * object so protocol conversions (or clients) that leave `search_engine` / `count` on the surface
 * still match the upstream shape.
 */
/* eslint-disable @typescript-eslint/naming-convention -- Z.ai / OpenAI-hosted tool wire keys (`web_search`, …) */

import { isPlainObject, passthroughTransform } from "../passthrough";

/** Keys Z.ai documents under `web_search` — if present on the tool object top-level, nest them. */
const GLM_WEB_SEARCH_ENVELOPE_KEYS = new Set([
  "enable",
  "search_engine",
  "search_result",
  "search_prompt",
  "count",
  "search_domain_filter",
  "search_recency_filter",
  "content_size",
  "max_uses",
  "force_search",
  "limit",
]);

function coerceWebSearchBoolishFields(envelope: Record<string, unknown>): void {
  for (const key of ["enable", "search_result"] as const) {
    const v = envelope[key];
    if (typeof v !== "string") {
      continue;
    }
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") {
      envelope[key] = true;
    } else if (s === "false" || s === "0") {
      envelope[key] = false;
    }
  }
}

function applyZAiWebSearchInChatDefaults(envelope: Record<string, unknown>): void {
  if (!("enable" in envelope)) {
    envelope.enable = true;
  }
  const se = envelope.search_engine;
  if (typeof se !== "string" || se.trim() === "") {
    envelope.search_engine = "search-prime";
  }
  if (!("search_result" in envelope)) {
    envelope.search_result = true;
  }
}

export function glmWebSearchEnvelopeTransform(
  tool: Record<string, unknown>
): Record<string, unknown> {
  if (tool.type !== "web_search") {
    return passthroughTransform(tool);
  }

  const passthroughTop: Record<string, unknown> = {};
  const fromTopLevel: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(tool)) {
    if (key === "type" || key === "web_search") {
      continue;
    }
    if (GLM_WEB_SEARCH_ENVELOPE_KEYS.has(key)) {
      fromTopLevel[key] = val;
    } else {
      passthroughTop[key] = val;
    }
  }

  const envelope = tool.web_search;
  let merged: Record<string, unknown>;
  if (isPlainObject(envelope)) {
    merged = { ...fromTopLevel, ...envelope };
  } else {
    merged = { ...fromTopLevel };
  }

  coerceWebSearchBoolishFields(merged);
  applyZAiWebSearchInChatDefaults(merged);

  return {
    type: "web_search",
    ...passthroughTop,
    web_search: merged,
  };
}
