/**
 * Chat Completions (non-streaming) JSON -> OpenAI Responses API JSON shape
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";
import type { OpenAIChatCompletionResponse, OpenAIResponseMessage } from "./openai-to-anthropic";

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
}

/**
 * Map chat.completion JSON to Responses API-style JSON for the client.
 */
export function convertChatCompletionToResponses(
  chat: OpenAIChatCompletionResponse,
  _originalModel: string
): OpenAIResponsesApiObject {
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
  return {
    id: `resp_${randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: chat.created,
    model: chat.model,
    status: "completed",
    output,
    usage: u
      ? {
          input_tokens: u.prompt_tokens ?? 0,
          output_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? 0,
        }
      : undefined,
  };
}

function buildMessageOutputItems(message: OpenAIResponseMessage): unknown[] {
  const text = typeof message.content === "string" ? message.content : "";
  if (!text && !message.thinking) {
    return [];
  }
  const content: unknown[] = [];
  if (text) {
    content.push({ type: "output_text", text });
  }
  if (message.thinking?.content) {
    content.push({
      type: "reasoning_text",
      text: message.thinking.content,
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
