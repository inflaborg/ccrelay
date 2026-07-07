/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";
import type { OpenAIChatCompletionResponse } from "../../converter/adapters/openai-chat-to-anthropic-response";
import { convertChatCompletionToResponses } from "../../converter/adapters/openai-chat-to-responses";
import {
  formatOpenAIChatCompletionsSse,
  formatOpenAIResponsesSse,
} from "../../converter/streaming/sse-formatters";
import type { AvailabilityProbeDetection } from "./types";

const PROBE_TEXT = "1";

function buildOpenAiChatResponse(model: string): OpenAIChatCompletionResponse {
  const created = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: PROBE_TEXT },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  };
}

function buildAnthropicJsonResponse(model: string): string {
  return JSON.stringify({
    type: "message",
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    role: "assistant",
    model,
    content: [{ type: "text", text: PROBE_TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

function buildAnthropicSseResponse(model: string): string {
  const msgId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const events: { eventName?: string; data: Record<string, unknown> }[] = [
    {
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
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    },
    {
      eventName: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    {
      eventName: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: PROBE_TEXT },
      },
    },
    {
      eventName: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      eventName: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    },
    { eventName: "message_stop", data: { type: "message_stop" } },
  ];

  return events
    .map(event => {
      const payload = JSON.stringify(event.data);
      return event.eventName
        ? `event: ${event.eventName}\ndata: ${payload}\n\n`
        : `data: ${payload}\n\n`;
    })
    .join("");
}

export interface AvailabilityProbeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  tokens: { inputTokens: number; outputTokens: number };
}

export function formatAvailabilityProbeResponse(
  detection: AvailabilityProbeDetection
): AvailabilityProbeResponse {
  const model = detection.model || "ccrelay-probe";
  const tokens = { inputTokens: 1, outputTokens: 1 };

  if (detection.responseSurface === "anthropic") {
    if (detection.stream) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: buildAnthropicSseResponse(model),
        tokens,
      };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: buildAnthropicJsonResponse(model),
      tokens,
    };
  }

  const chat = buildOpenAiChatResponse(model);

  if (detection.responseSurface === "openai_responses") {
    const response = convertChatCompletionToResponses(chat, model);
    if (detection.stream) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: formatOpenAIResponsesSse(response),
        tokens,
      };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
      tokens,
    };
  }

  if (detection.stream) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: formatOpenAIChatCompletionsSse(chat),
      tokens,
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chat),
    tokens,
  };
}
