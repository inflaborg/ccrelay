/**
 * Azure OpenAI Chat Completions: strip fields the upstream rejects when relaying
 * from Anthropic-shaped cross-protocol conversion.
 */

function stripCacheControlFromContent(content: unknown): unknown {
  if (content === null || typeof content === "string" || !Array.isArray(content)) {
    return content;
  }
  return content.map((part: unknown): unknown => {
    if (part && typeof part === "object" && "cache_control" in part) {
      const next = { ...(part as Record<string, unknown>) };
      delete next.cache_control;
      return next;
    }
    return part;
  });
}

function sanitizeMessageRecord(msg: Record<string, unknown>): void {
  delete msg.thinking;
  msg.content = stripCacheControlFromContent(msg.content);

  const toolCalls = msg.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return;
  }
  for (const tc of toolCalls) {
    if (tc && typeof tc === "object") {
      delete (tc as Record<string, unknown>).extra_content;
    }
  }
}

/**
 * Strip top-level `reasoning`, message `thinking`, `cache_control` on content parts,
 * and `extra_content` on tool_calls — fields Azure OpenAI Chat rejects from bridged requests.
 */
export function azureChatSanitize(data: Record<string, unknown>): void {
  delete data.reasoning;

  const messages = data.messages;
  if (!Array.isArray(messages)) {
    return;
  }
  for (const msg of messages) {
    if (msg && typeof msg === "object") {
      sanitizeMessageRecord(msg as Record<string, unknown>);
    }
  }
}
