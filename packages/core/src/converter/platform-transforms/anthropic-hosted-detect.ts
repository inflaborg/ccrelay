/**
 * Detect Anthropic Messages request bodies that declare hosted web search server tools.
 *
 * @deprecated Prefer `anthropicBodyHasHostedTool(body, "web_search")` from `converter/hosted-tools`.
 */

import { anthropicBodyHasHostedTool } from "../hosted-tools";

/**
 * `/v1/messages` JSON: **`tools` only** — must include a hosted web-search server tool declaration.
 * Do not infer from `messages` / tool blocks: multi-turn turns are not necessarily search.
 */
export function anthropicMessagesBodyHasHostedWebSearch(body: Record<string, unknown>): boolean {
  return anthropicBodyHasHostedTool(body, "web_search");
}
