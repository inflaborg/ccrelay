import { randomUUID } from "crypto";

import type { SearchProviderResponse } from "./providers/types";

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic Messages API wire keys */

const MSG_ID_PREFIX = "msg_";
const TOOL_USE_ID_PREFIX = "srvtoolu_";
const SSE_TEXT_CHUNK_SIZE = 64;

// ─── JSON response ──────────────────────────────────────────────────────────

export function formatAnthropicWebResponse(
  query: string,
  searchResult: SearchProviderResponse,
  model: string
): string {
  const toolUseId = `${TOOL_USE_ID_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const msgId = `${MSG_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  const content: unknown[] = [
    {
      type: "server_tool_use",
      id: toolUseId,
      name: "web_search",
      input: { query },
    },
    {
      type: "web_search_tool_result",
      tool_use_id: toolUseId,
      content: searchResult.results.map(r => ({
        type: "web_search_result",
        url: r.url,
        title: r.title,
        ...(r.content ? { encrypted_content: r.content } : {}),
      })),
    },
    {
      type: "text",
      text: searchResult.answer ?? "",
    },
  ];

  return JSON.stringify({
    type: "message",
    id: msgId,
    role: "assistant",
    model,
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

// ─── SSE response ───────────────────────────────────────────────────────────

export function formatAnthropicWebSearchSse(
  query: string,
  searchResult: SearchProviderResponse,
  model: string
): string {
  const toolUseId = `${TOOL_USE_ID_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const msgId = `${MSG_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  const events: { eventName?: string; data: Record<string, unknown> }[] = [];

  // message_start
  events.push({
    eventName: "message_start",
    data: {
      type: "message_start",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  });

  // Block 0: server_tool_use
  events.push({
    eventName: "content_block_start",
    data: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "server_tool_use",
        id: toolUseId,
        name: "web_search",
        input: { query },
      },
    },
  });
  events.push({ eventName: "content_block_stop", data: { type: "content_block_stop", index: 0 } });

  // Block 1: web_search_tool_result
  events.push({
    eventName: "content_block_start",
    data: {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: toolUseId,
        content: searchResult.results.map(r => ({
          type: "web_search_result",
          url: r.url,
          title: r.title,
          ...(r.content ? { encrypted_content: r.content } : {}),
        })),
      },
    },
  });
  events.push({ eventName: "content_block_stop", data: { type: "content_block_stop", index: 1 } });

  // Block 2: text (answer) — chunked
  const answerText = searchResult.answer ?? "";
  events.push({
    eventName: "content_block_start",
    data: {
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "" },
    },
  });

  for (let i = 0; i < answerText.length; i += SSE_TEXT_CHUNK_SIZE) {
    events.push({
      eventName: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: answerText.slice(i, i + SSE_TEXT_CHUNK_SIZE) },
      },
    });
  }

  events.push({ eventName: "content_block_stop", data: { type: "content_block_stop", index: 2 } });

  // message_delta
  events.push({
    eventName: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: answerText.length },
    },
  });

  // message_stop
  events.push({ eventName: "message_stop", data: { type: "message_stop" } });

  return serializeSseEvents(events);
}

function serializeSseEvents(
  events: { eventName?: string; data: Record<string, unknown> }[]
): string {
  const parts: string[] = [];
  for (const event of events) {
    const payload = JSON.stringify(event.data);
    if (event.eventName) {
      parts.push(`event: ${event.eventName}\ndata: ${payload}\n\n`);
    } else {
      parts.push(`data: ${payload}\n\n`);
    }
  }
  return parts.join("");
}
