/**
 * Anthropic Messages non-streaming JSON response -> OpenAI chat.completion JSON
 * Inverse of openai-to-anthropic convertResponseToAnthropic
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";
import type {
  OpenAIChatCompletionResponse,
  OpenAIResponseMessage,
  OpenAIChoice,
} from "./openai-chat-to-anthropic-response";
import type {
  AnthropicMessageResponse,
  AnthropicContentBlock,
} from "./openai-chat-to-anthropic-response";
import { isServerToolResultBlock } from "../../types";

/**
 * Non-streaming Anthropic `message` response to OpenAI chat.completion shape
 */
export function convertAnthropicResponseToOpenAI(
  anthropic: AnthropicMessageResponse,
  originalModelForClient: string
): OpenAIChatCompletionResponse {
  const model = originalModelForClient || anthropic.model;
  const message = buildOpenAIMessageFromContent(anthropic.content);

  const choice: OpenAIChoice = {
    index: 0,
    message,
    finish_reason: mapAnthropicStopReasonToOpenAI(anthropic.stop_reason, anthropic.content),
  };

  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
    usage: anthropic.usage
      ? {
          prompt_tokens:
            (anthropic.usage.input_tokens || 0) + (anthropic.usage.cache_read_input_tokens || 0),
          completion_tokens: anthropic.usage.output_tokens || 0,
          total_tokens:
            (anthropic.usage.input_tokens || 0) +
            (anthropic.usage.output_tokens || 0) +
            (anthropic.usage.cache_read_input_tokens || 0),
          prompt_tokens_details: {
            cached_tokens: anthropic.usage.cache_read_input_tokens || 0,
          },
        }
      : undefined,
  };
}

function mapAnthropicStopReasonToOpenAI(reason: string, blocks: AnthropicContentBlock[]): string {
  if (reason === "tool_use") {
    const hasClientToolUse = blocks.some(b => b.type === "tool_use");
    if (!hasClientToolUse) {
      return "stop";
    }
    return "tool_calls";
  }
  const mapping: Record<string, string> = {
    end_turn: "stop",
    max_tokens: "length",
    stop_sequence: "stop",
  };
  return mapping[reason] || "stop";
}

/** Uniform opaque serialization — no tool-specific branches. */
function serializeServerToolResultContent(content: unknown): string {
  return JSON.stringify(content ?? null);
}

function buildOpenAIMessageFromContent(blocks: AnthropicContentBlock[]): OpenAIResponseMessage {
  const message: OpenAIResponseMessage = {
    role: "assistant",
  };

  const textParts: string[] = [];
  const toolCalls: NonNullable<OpenAIResponseMessage["tool_calls"]> = [];

  for (const b of blocks) {
    if (b.type === "text") {
      textParts.push(b.text);
    } else if (b.type === "thinking") {
      message.thinking = {
        content: b.thinking,
        signature: b.signature,
      };
    } else if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
    } else if (b.type === "server_tool_use") {
      textParts.push(JSON.stringify(b));
    } else if (isServerToolResultBlock(b)) {
      textParts.push(serializeServerToolResultContent((b as { content?: unknown }).content));
    }
  }

  if (textParts.length) {
    message.content = textParts.join("\n");
  } else if (!toolCalls.length) {
    message.content = "";
  }
  if (toolCalls.length) {
    message.tool_calls = toolCalls;
  }

  return message;
}

/**
 * Type guard: parsed JSON is a non-streaming Anthropic message response
 */
export function isAnthropicMessageResponse(data: unknown): data is AnthropicMessageResponse {
  if (!data || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.type === "message" && o.role === "assistant" && Array.isArray(o.content);
}
