/**
 * Xiaomi MiMo OpenAI-chat `web_search`: passthrough tool fields; drop `user_location` (optional upstream);
 * map Anthropic `max_uses` / `max_users` → `max_keyword` when `max_keyword` is absent; fill MiMo defaults only for missing slots.
 */

import { isPlainObject, passthroughTransform } from "../passthrough";

export function mimoWebSearchTransform(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type !== "web_search") {
    return passthroughTransform(tool);
  }

  const out: Record<string, unknown> = { ...tool };

  const envelope = out.web_search;
  if ("web_search" in out && (envelope === null || !isPlainObject(envelope))) {
    delete out.web_search;
  }

  delete out.user_location;

  if (typeof out.max_keyword !== "number") {
    if (typeof out.max_uses === "number") {
      out.max_keyword = out.max_uses;
    } else if (typeof out.max_users === "number") {
      out.max_keyword = out.max_users;
    }
  }
  if (typeof out.max_keyword !== "number") {
    out.max_keyword = 3;
  }
  if (typeof out.force_search !== "boolean") {
    out.force_search = true;
  }
  if (typeof out.limit !== "number") {
    out.limit = 1;
  }

  return out;
}
