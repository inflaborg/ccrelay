/**
 * Platform-specific transforms for OpenAI Chat Completions bodies (Anthropic client → OpenAI upstream).
 * Azure OpenAI strict schema, Gemini OpenAI-compat quirks, and profile selection from provider config.
 */

import type { Provider, OpenAICompat } from "../../types";
import type {
  OpenAIMessage,
  OpenAIMessageRequest,
  OpenAIToolCall,
} from "../adapters/anthropic-to-openai-chat-request";

/**
 * Chat Completions body compat when bridging an Anthropic Messages client to this upstream.
 * Only `azure_openai` enables strict sanitization; everything else behaves as generic OpenAI.
 */
export function resolveOpenAICompatForAnthropicToOpenAI(provider: Provider): OpenAICompat {
  return provider.openaiCompat === "azure_openai" ? "azure_openai" : "default";
}

// --- Azure OpenAI ---

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

/** Strip fields Azure OpenAI rejects when relaying from an Anthropic-shaped client. */
export function sanitizeAzureOpenAiChatRequest(req: OpenAIMessageRequest): OpenAIMessageRequest {
  const out: OpenAIMessageRequest = { ...req };
  delete out.reasoning;
  out.messages = (out.messages ?? []).map(sanitizeMessage);
  return out;
}

// --- Gemini OpenAI-compat ---

export function isGeminiOpenAiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini");
}

/**
 * Gemini OpenAI-compat expects extended-thinking signatures on tool calls, not a top-level
 * `reasoning` field or a standalone assistant `thinking` blob.
 */
export function withOptionalGeminiThoughtSignature(
  toolCall: OpenAIToolCall,
  gemini: boolean,
  thoughtSignature: string | undefined
): OpenAIToolCall {
  if (gemini && thoughtSignature) {
    return {
      ...toolCall,
      /* eslint-disable @typescript-eslint/naming-convention -- Gemini wire (snake_case) */
      extra_content: {
        google: { thought_signature: thoughtSignature },
      },
    };
  }
  return toolCall;
}
