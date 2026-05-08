/**
 * GLM inbound: Chat completion may include top-level `web_search[]` (not OpenAI-standard).
 * Merge into Anthropic assistant `content` as `server_tool_use` + `web_search_tool_result`.
 */

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic Messages API wire keys */

import { randomUUID } from "crypto";

import type { AnthropicContentBlock } from "../../adapters/openai-chat-to-anthropic-response";

interface GlmWebSearchEntry {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
}

/** Prepend synthesized server-tool blocks when GLM returned `web_search` results on the Chat body. */
export function glmWebSearchResponseTransform(
  openaiCompletionBody: Record<string, unknown>,
  anthropicBlocks: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  const webSearch = openaiCompletionBody.web_search;
  if (!Array.isArray(webSearch) || webSearch.length === 0) {
    return anthropicBlocks;
  }

  const toolUseId = `srvtoolu_${randomUUID().replace(/-/g, "")}`;

  const serverToolUse: AnthropicContentBlock = {
    type: "server_tool_use",
    id: toolUseId,
    name: "web_search",
    input: {},
  };

  const searchResults = (webSearch as GlmWebSearchEntry[]).map(entry => ({
    type: "web_search_result" as const,
    url: typeof entry.link === "string" ? entry.link : "",
    title: typeof entry.title === "string" ? entry.title : "",
    ...(typeof entry.content === "string" && entry.content.length > 0
      ? { encrypted_content: entry.content }
      : {}),
  }));

  const toolResult: AnthropicContentBlock = {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    content: searchResults,
  };

  return [serverToolUse, toolResult, ...anthropicBlocks];
}
