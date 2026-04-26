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

/** Chars per synthetic `response.output_text.delta` when upstream is non-streaming. */
const SSE_TEXT_CHUNK = 64;

/**
 * Synthesize OpenAI Responses API SSE for clients that sent `stream: true` (e.g. Codex).
 * Cross-protocol path uses non-streaming upstream. Event consumers often require
 * `response.output_text.delta` / `response.output_text.done` (not only `response.completed`),
 * or the UI shows an empty reply despite HTTP 200.
 */
export function formatOpenAIResponsesSse(response: OpenAIResponsesApiObject): string {
  const textPayload = extractSseTextPayload(response);
  if (textPayload) {
    return formatOpenAIResponsesSseWithTextDeltas(response, textPayload);
  }
  return formatOpenAIResponsesSseMinimal(response);
}

function formatOpenAIResponsesSseMinimal(response: OpenAIResponsesApiObject): string {
  let sequence_number = 0;
  const lines: string[] = [];
  const push = (obj: Record<string, unknown>) => {
    lines.push(`data: ${JSON.stringify({ ...obj, sequence_number: sequence_number++ })}\n\n`);
  };
  const createdResponse = { ...response, status: "in_progress" as const, output: [] as unknown[] };
  push({ type: "response.created", response: createdResponse });
  push({ type: "response.completed", response });
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}

function extractSseTextPayload(
  response: OpenAIResponsesApiObject
):
  | { itemId: string; text: string; outputIndex: number; completedItem: unknown }
  | null {
  for (let outputIndex = 0; outputIndex < response.output.length; outputIndex++) {
    const item = response.output[outputIndex];
    if (!item || typeof item !== "object") {
      continue;
    }
    if ((item as { type?: string }).type !== "message") {
      continue;
    }
    const m = item as { id?: string; content?: Array<{ type?: string; text?: string }> };
    const itemId =
      typeof m.id === "string" && m.id.length > 0
        ? m.id
        : `msg_${randomUUID().replace(/-/g, "")}`;
    let text = "";
    for (const c of m.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") {
        text += c.text;
      }
    }
    if (text.length > 0) {
      return { itemId, text, outputIndex, completedItem: item };
    }
  }
  return null;
}

function formatOpenAIResponsesSseWithTextDeltas(
  response: OpenAIResponsesApiObject,
  p: { itemId: string; text: string; outputIndex: number; completedItem: unknown }
): string {
  const { itemId, text, outputIndex, completedItem } = p;
  let sequence_number = 0;
  const lines: string[] = [];
  const push = (obj: Record<string, unknown>) => {
    lines.push(`data: ${JSON.stringify({ ...obj, sequence_number: sequence_number++ })}\n\n`);
  };

  const createdResponse = { ...response, status: "in_progress" as const, output: [] as unknown[] };
  push({ type: "response.created", response: createdResponse });

  const inProgressMessage = {
    type: "message",
    id: itemId,
    role: "assistant",
    status: "in_progress",
    content: [] as unknown[],
  };
  push({
    type: "response.output_item.added",
    item: inProgressMessage,
    output_index: outputIndex,
  });

  for (let i = 0; i < text.length; i += SSE_TEXT_CHUNK) {
    const delta = text.slice(i, i + SSE_TEXT_CHUNK);
    push({
      type: "response.output_text.delta",
      item_id: itemId,
      content_index: 0,
      output_index: outputIndex,
      delta,
      logprobs: [] as unknown[],
    });
  }
  push({
    type: "response.output_text.done",
    item_id: itemId,
    content_index: 0,
    output_index: outputIndex,
    text,
    logprobs: [] as unknown[],
  });
  push({
    type: "response.output_item.done",
    item: completedItem,
    output_index: outputIndex,
  });
  push({ type: "response.completed", response });
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}

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
