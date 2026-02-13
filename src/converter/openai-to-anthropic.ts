/**
 * OpenAI API format to Anthropic API format converter
 * Converts OpenAI Chat Completions responses to Anthropic Messages format
 *
 * Key design: Preserves original tool_call_id from OpenAI response,
 * no external storage needed for signature handling.
 */

/* eslint-disable @typescript-eslint/naming-convention */
// External API fields use snake_case (finish_reason, tool_calls, etc.)

import { randomUUID } from "crypto";

/**
 * OpenAI Chat Completions response format
 */
export interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

/**
 * OpenAI choice in response
 */
export interface OpenAIChoice {
  index: number;
  message: OpenAIResponseMessage;
  finish_reason: string;
  delta?: {
    role?: string;
    content?: string;
    tool_calls?: OpenAIToolCall[];
    thinking?: {
      content?: string;
      signature?: string;
    };
    annotations?: Annotation[];
  };
}

/**
 * OpenAI response message
 */
export interface OpenAIResponseMessage {
  role: string;
  content?: string;
  tool_calls?: OpenAIToolCall[];
  thinking?: {
    content?: string;
    signature?: string;
  };
  annotations?: Annotation[];
}

/**
 * Annotation (e.g., web search results)
 * Allows additional properties for extensibility and edge case testing
 */
export interface Annotation {
  url_citation?: {
    url: string;
    title: string;
  };
  [key: string]: unknown; // Allow additional properties
}

/**
 * OpenAI tool call in response
 */
export interface OpenAIToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
    thought_signature?: string;
  };
  extra_content?: {
    google?: {
      thought_signature?: string;
    };
  };
}

/**
 * OpenAI usage information
 */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

/**
 * Anthropic Message response format
 */
export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

/**
 * Anthropic content block in response
 */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicServerToolUseBlock
  | AnthropicThinkingBlock
  | AnthropicWebSearchToolResultBlock;

/**
 * Anthropic text block
 */
export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

/**
 * Anthropic tool use block
 */
export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Anthropic server tool use block (for web search)
 */
export interface AnthropicServerToolUseBlock {
  type: "server_tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Anthropic thinking block (for Gemini thought_signature)
 */
export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

/**
 * Anthropic web search tool result block
 */
export interface AnthropicWebSearchToolResultBlock {
  type: "web_search_tool_result";
  tool_use_id: string;
  content: AnthropicWebSearchResult[];
}

/**
 * Anthropic web search result
 */
export interface AnthropicWebSearchResult {
  type: "web_search_result";
  url: string;
  title: string;
}

/**
 * Anthropic usage information
 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

/**
 * Convert OpenAI response to Anthropic format
 *
 * Design principles:
 * 1. Preserves original tool_call.id as tool_use.id (no ID generation)
 * 2. Inlines thought_signature in thinking block (no external storage)
 * 3. Stateless - no database required
 */
export function convertResponseToAnthropic(
  openai: OpenAIChatCompletionResponse,
  originalModel: string
): AnthropicMessageResponse {
  const choice = openai.choices[0];
  const message = choice.message;

  const content: AnthropicContentBlock[] = [];

  // Extract thought_signature from OpenAI response (Gemini format)
  let thoughtSignature: string | undefined;

  // Try to get signature from message.thinking (unified format)
  if (message.thinking?.signature) {
    thoughtSignature = message.thinking.signature;
  } else {
    // Try to get signature from tool_calls extra_content (Gemini native format)
    for (const tc of message.tool_calls || []) {
      if (tc.extra_content?.google?.thought_signature) {
        thoughtSignature = tc.extra_content.google.thought_signature;
        break;
      }
      if (tc.function.thought_signature) {
        thoughtSignature = tc.function.thought_signature;
        break;
      }
    }
  }

  // Add thinking block first if signature exists
  if (thoughtSignature) {
    content.push({
      type: "thinking",
      thinking: message.thinking?.content || "",
      signature: thoughtSignature,
    });
  }

  // Handle text content
  if (message.content) {
    content.push({
      type: "text",
      text: message.content,
    });
  } else if (message.tool_calls && message.tool_calls.length > 0 && !thoughtSignature) {
    content.push({
      type: "text",
      text: "",
    });
  }

  // Handle tool_calls - preserve original IDs
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id, // Preserve original OpenAI tool_call.id
        name: tc.function.name,
        input: parseFunctionArguments(tc.function.arguments),
      });
    }
  }

  // Handle annotations (web search results, etc.)
  // Reference: creates server_tool_use + web_search_tool_result pair with matching id
  if (message.annotations && message.annotations.length > 0) {
    const toolUseId = `srvtoolu_${randomUUID()}`;
    content.push({
      type: "server_tool_use",
      id: toolUseId,
      name: "web_search",
      input: { query: "" },
    });
    content.push({
      type: "web_search_tool_result",
      tool_use_id: toolUseId,
      content: message.annotations
        .filter(a => a.url_citation)
        .map(a => ({
          type: "web_search_result" as const,
          url: a.url_citation!.url,
          title: a.url_citation!.title,
        })),
    });
  }

  return {
    id: openai.id,
    type: "message",
    role: "assistant",
    content,
    model: originalModel,
    stop_reason: convertFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: openai.usage
      ? {
          input_tokens:
            (openai.usage.prompt_tokens || 0) -
            (openai.usage.prompt_tokens_details?.cached_tokens || 0),
          output_tokens: openai.usage.completion_tokens || 0,
          cache_read_input_tokens: openai.usage.prompt_tokens_details?.cached_tokens || 0,
        }
      : {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
        },
  };
}

/**
 * Convert finish_reason from OpenAI to Anthropic format
 */
function convertFinishReason(reason: string): string {
  const mapping: Record<string, string> = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "stop_sequence",
  };
  return mapping[reason] || "end_turn";
}

/**
 * Parse function arguments string to object
 */
function parseFunctionArguments(args: string): Record<string, unknown> {
  try {
    const argumentsStr = args || "{}";
    if (typeof argumentsStr === "object") {
      return argumentsStr as Record<string, unknown>;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
    const parsed = JSON.parse(argumentsStr);

    return typeof parsed === "object" ? (parsed as Record<string, unknown>) : { text: args || "" };
  } catch {
    return { text: args || "" };
  }
}
