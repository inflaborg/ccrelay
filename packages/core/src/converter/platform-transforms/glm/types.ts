/**
 * Shared GLM-hosted search hit shape (Chat `web_search[]` and Anthropic tool_result JSON).
 */

export interface GlmWebSearchEntry {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
}
