/**
 * GLM / Z.ai OpenAI-chat `web_search`: nested `web_search` object cannot be absent or null upstream.
 * "Web Search in Chat" only returns real retrieval when `search_engine` and `search_result` are set
 * (see Z.AI guides); `{ enable, max_uses }` alone is accepted but does not populate response `web_search`.
 */

import { isPlainObject, passthroughTransform } from "../passthrough";

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
  const out: Record<string, unknown> = { ...tool };
  const envelope = tool.web_search;
  if (!isPlainObject(envelope)) {
    const extra: Record<string, unknown> = {};
    const maxUses = tool.max_uses;
    if (typeof maxUses === "number") {
      extra.max_uses = maxUses;
    }
    delete out.web_search;
    delete out.max_uses;
    out.web_search = Object.keys(extra).length > 0 ? { enable: true, ...extra } : { enable: true };
    applyZAiWebSearchInChatDefaults(out.web_search as Record<string, unknown>);
  } else {
    out.web_search = { ...envelope };
    applyZAiWebSearchInChatDefaults(out.web_search as Record<string, unknown>);
  }
  return out;
}
