/**
 * GLM / Z.ai OpenAI-chat `web_search`: nested `web_search` object cannot be absent or null upstream.
 */

import { isPlainObject, passthroughTransform } from "../passthrough";

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
  }
  return out;
}
