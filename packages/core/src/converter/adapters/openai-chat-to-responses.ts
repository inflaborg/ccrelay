/**
 * OpenAI Chat Completions (non-streaming) JSON -> Responses API JSON shape.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";
import type {
  OpenAIChatCompletionResponse,
  OpenAIResponseMessage,
} from "./openai-chat-to-anthropic-response";
import type { ResponsesRequestEcho } from "../../types";
import { mergedResponseShellEcho } from "./openai-responses-to-chat";

/** Minimal Response object fields used by many SDKs */
export interface OpenAIResponsesApiObject {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed" | "incomplete";
  output: unknown[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  instructions?: string | null;
  parallel_tool_calls?: boolean;
  previous_response_id?: string | null;
  reasoning?: { effort?: string | null; summary?: string | null };
  store?: boolean;
  text?: { format?: unknown };
  tool_choice?: unknown;
  tools?: unknown[];
  truncation?: string;
  user?: string | null;
  metadata?: Record<string, unknown>;
}

export function convertChatCompletionToResponses(
  chat: OpenAIChatCompletionResponse,
  _originalModel: string,
  echo?: ResponsesRequestEcho
): OpenAIResponsesApiObject {
  const shell = mergedResponseShellEcho(echo);

  if (!chat.choices || chat.choices.length === 0) {
    return {
      id: `resp_${randomUUID().replace(/-/g, "")}`,
      object: "response",
      created_at: chat.created || Math.floor(Date.now() / 1000),
      model: chat.model || "",
      status: "completed",
      output: [],
      usage: undefined,
      ...shell,
    };
  }
  const choice = chat.choices[0];
  const message = choice?.message;
  const output: unknown[] = [];

  if (message) {
    const msgItems = buildMessageOutputItems(message);
    for (const it of msgItems) {
      output.push(it);
    }
    for (const fc of buildFunctionCallOutputItems(message.tool_calls)) {
      output.push(fc);
    }
  }

  const u = chat.usage;
  const coreUsage = u
    ? {
        input_tokens: u.prompt_tokens ?? 0,
        output_tokens: u.completion_tokens ?? 0,
        total_tokens: u.total_tokens ?? 0,
      }
    : undefined;

  return {
    id: `resp_${randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: chat.created,
    model: chat.model,
    status: "completed",
    output,
    usage: coreUsage,
    ...shell,
  };
}

function messageContentToString(message: OpenAIResponseMessage): string {
  const c = message.content as string | Array<{ type?: string; text?: string }> | undefined;
  if (typeof c === "string") {
    return c;
  }
  if (Array.isArray(c)) {
    return c
      .map(p => (p && typeof p === "object" && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

function buildMessageOutputItems(message: OpenAIResponseMessage): unknown[] {
  const text = messageContentToString(message);
  const reasoningFromThinking =
    typeof message.thinking?.content === "string" && message.thinking.content.length > 0
      ? message.thinking.content
      : undefined;
  const reasoningFromField =
    typeof message.reasoning_content === "string" && message.reasoning_content.length > 0
      ? message.reasoning_content
      : undefined;
  const reasoningText = reasoningFromThinking ?? reasoningFromField;
  if (!text && !reasoningText) {
    return [];
  }
  const content: unknown[] = [];
  if (text) {
    content.push({ type: "output_text", text });
  }
  if (reasoningText) {
    content.push({
      type: "reasoning_text",
      text: reasoningText,
    });
  }
  if (content.length === 0) {
    return [];
  }
  return [
    {
      type: "message",
      id: `msg_${randomUUID().replace(/-/g, "")}`,
      role: "assistant",
      status: "completed",
      content,
    },
  ];
}

function buildFunctionCallOutputItems(toolCalls: OpenAIResponseMessage["tool_calls"]): unknown[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }
  return toolCalls.map(tc => ({
    type: "function_call",
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
    call_id: tc.id,
    status: "completed",
  }));
}
