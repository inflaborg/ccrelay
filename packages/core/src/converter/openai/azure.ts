/**
 * Strip Chat Completions fields that Azure OpenAI rejects (strict schema) when relaying
 * from an Anthropic-shaped client.
 */

import type { OpenAIMessage, OpenAIMessageRequest } from "../anthropic-to-openai";

function stripCacheControlFromContent(content: OpenAIMessage["content"]): OpenAIMessage["content"] {
  if (content === null || typeof content === "string" || !Array.isArray(content)) {
    return content;
  }
  return content.map(part => {
    if (part && typeof part === "object" && "cache_control" in part) {
      const r = part as Record<string, unknown>;
      const next = { ...r };
      delete next.cache_control;
      return next as unknown as (typeof content)[number];
    }
    return part;
  });
}

function sanitizeMessage(msg: OpenAIMessage): OpenAIMessage {
  const out: OpenAIMessage = { ...msg };
  delete out.thinking;
  out.content = stripCacheControlFromContent(out.content);
  if (out.tool_calls?.length) {
    out.tool_calls = out.tool_calls.map(tc => {
      const r = { ...tc };
      delete r.extra_content;
      return r;
    });
  }
  return out;
}

export function sanitizeAzureOpenAiChatRequest(req: OpenAIMessageRequest): OpenAIMessageRequest {
  const out: OpenAIMessageRequest = { ...req };
  delete out.reasoning;
  out.messages = (out.messages ?? []).map(sanitizeMessage);
  return out;
}
