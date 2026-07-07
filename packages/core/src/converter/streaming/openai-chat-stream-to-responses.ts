/**
 * Streaming converter: Chat Completions SSE chunks → Responses API SSE events.
 *
 * Processes one upstream `data:` line at a time, maintains conversion state,
 * and returns zero or more Responses API SSE event strings to write to the client.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";

import type { ResponsesRequestEcho } from "../../types";
import { mergedResponseShellEcho } from "../adapters/openai-responses-to-chat";

const SSE_TEXT_CHUNK = 64;

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface ToolCallState {
  id: string;
  name: string;
  callId: string;
  arguments: string;
}

export interface StreamingConversionState {
  responseId: string;
  reasoningId: string;
  messageId: string;
  model: string;
  createdAt: number;
  seq: number;
  phase: "initial" | "created" | "reasoning" | "text" | "tool" | "finished" | "done";
  accumulatedReasoning: string;
  accumulatedText: string;
  toolCalls: ToolCallState[];
  currentToolIndex: number;
  outputIndex: number;
  /** Tool calls received finish_reason; close on [DONE] after trailing arg deltas. */
  toolsPendingClose: boolean;
  /** Original Responses request fields to echo back in response shells */
  echo?: ResponsesRequestEcho;
  usage?: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export function createStreamingState(opts?: {
  echo?: ResponsesRequestEcho;
}): StreamingConversionState {
  return {
    responseId: `resp_${randomUUID().replace(/-/g, "")}`,
    reasoningId: `rs_${randomUUID().replace(/-/g, "")}`,
    messageId: `msg_${randomUUID().replace(/-/g, "")}`,
    model: "",
    createdAt: Math.floor(Date.now() / 1000),
    seq: 0,
    phase: "initial",
    accumulatedReasoning: "",
    accumulatedText: "",
    toolCalls: [],
    currentToolIndex: 0,
    outputIndex: 0,
    toolsPendingClose: false,
    ...(opts?.echo !== undefined ? { echo: opts.echo } : {}),
  };
}

/**
 * Process a single Chat Completions SSE data line.
 * @param state  Mutable state — updated in place.
 * @param line   A single `data:` value (prefix already stripped). May be `[DONE]`.
 * @returns      Array of Responses API SSE event strings to emit.
 */
export function processStreamingChunk(state: StreamingConversionState, line: string): string[] {
  const trimmed = line.trim();

  // End-of-stream sentinel
  if (trimmed === "[DONE]") {
    return flushCompletion(state);
  }

  let chunk: Record<string, unknown>;
  try {
    chunk = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return []; // ignore malformed lines
  }

  if (typeof chunk.model === "string" && chunk.model) {
    state.model = chunk.model;
  }

  // Track usage if present on any chunk
  if (chunk.usage && typeof chunk.usage === "object") {
    const u = chunk.usage as Record<string, unknown>;
    const inputDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
    const outputDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
    state.usage = {
      input_tokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
      input_tokens_details: {
        cached_tokens:
          typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens : 0,
      },
      output_tokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
      output_tokens_details: {
        reasoning_tokens:
          typeof outputDetails?.reasoning_tokens === "number" ? outputDetails.reasoning_tokens : 0,
      },
      total_tokens: typeof u.total_tokens === "number" ? u.total_tokens : 0,
    };
  }

  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return [];
  }

  const choice = choices[0] as Record<string, unknown>;
  const delta = choice.delta as Record<string, unknown> | undefined;
  const finishReason = choice.finish_reason as string | null | undefined;

  if (!delta) {
    // No delta — might just be a usage-only chunk
    return [];
  }

  const events: string[] = [];

  // Role-only prelude (MiMo/OpenAI-style): defer message/reasoning item until content arrives.
  if (state.phase === "initial" && delta.role) {
    events.push(...emitResponseCreated(state));
    state.phase = "created";
  }

  // Reasoning content deltas (reasoning_content — non-standard, used by DeepSeek/MiMo etc.)
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    if (state.phase === "initial" || state.phase === "created") {
      if (state.phase === "initial") {
        events.push(...emitResponseCreated(state));
      }
      state.phase = "reasoning";
      events.push(...emitReasoningItemAdded(state));
    }
    state.accumulatedReasoning += delta.reasoning_content;
    events.push(...emitReasoningTextDeltas(state, delta.reasoning_content));
  }

  // Text content deltas
  if (typeof delta.content === "string" && delta.content.length > 0) {
    if (state.phase === "initial" || state.phase === "created") {
      if (state.phase === "initial") {
        events.push(...emitResponseCreated(state));
      }
      state.phase = "text";
      events.push(...emitOutputItemAdded(state, "message"));
      events.push(...emitContentPartAdded(state, state.messageId, "output_text"));
    } else if (state.phase === "reasoning") {
      events.push(...emitReasoningTextDone(state));
      events.push(...emitReasoningItemDone(state));
      state.outputIndex++;
      state.phase = "text";
      events.push(...emitOutputItemAdded(state, "message"));
      events.push(...emitContentPartAdded(state, state.messageId, "output_text"));
    }
    state.accumulatedText += delta.content;
    events.push(...emitTextDeltasForItem(state, state.messageId, delta.content));
  }

  // Tool call deltas
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    if (state.phase === "initial") {
      events.push(...emitResponseCreated(state));
      state.phase = "created";
    }
    // MiMo et al.: reasoning_content deltas then tool_calls with no intervening assistant text
    if (state.phase === "reasoning") {
      events.push(...emitReasoningTextDone(state));
      events.push(...emitReasoningItemDone(state));
      state.outputIndex++;
    }
    // created/reasoning → tool directly; only open message when delta.content arrives
    if (state.phase === "created" || state.phase === "reasoning") {
      state.phase = "tool";
    }

    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const fn = tc.function as Record<string, unknown> | undefined;
      const tcIndex = typeof tc.index === "number" ? tc.index : 0;

      // New tool call (first chunk has name)
      if (fn && typeof fn.name === "string") {
        // If we have accumulated text, close the text item first
        if (state.phase === "text" && state.accumulatedText) {
          events.push(...emitTextDone(state));
          events.push(...emitOutputItemDone(state, "message"));
          state.outputIndex++;
        }
        state.phase = "tool";

        const callId = typeof tc.id === "string" ? tc.id : `call_${randomUUID().replace(/-/g, "")}`;
        state.toolCalls[tcIndex] = {
          id: `fc_${randomUUID().replace(/-/g, "")}`,
          name: fn.name,
          callId,
          arguments: "",
        };
        events.push(...emitOutputItemAdded(state, "function_call", tcIndex));
      }

      // Argument deltas
      if (fn && typeof fn.arguments === "string" && fn.arguments.length > 0) {
        const tool = state.toolCalls[tcIndex];
        if (tool) {
          tool.arguments += fn.arguments;
          events.push(...emitFunctionCallArgDeltas(state, tcIndex, fn.arguments));
        }
      }
    }
  }

  // Finish reason
  if (finishReason) {
    if (state.phase === "reasoning") {
      events.push(...emitReasoningTextDone(state));
      events.push(...emitReasoningItemDone(state));
      state.outputIndex++;
    } else if (state.phase === "text") {
      events.push(...emitTextDone(state));
      events.push(...emitOutputItemDone(state, "message"));
      state.outputIndex++;
    } else if (state.phase === "tool") {
      // Defer tool close until [DONE] so trailing argument deltas after finish_reason are included.
      state.toolsPendingClose = true;
    } else if (state.phase === "initial") {
      events.push(...emitResponseCreated(state));
    }

    // Defer `response.completed` / `[DONE]` until `[DONE]` (allows a trailing usage-only chunk).
    state.phase = "finished";
  }

  return events;
}

/**
 * Create an SSE line buffer that handles TCP chunk boundaries.
 * Feeds complete lines to the callback.
 */
export function createSseLineBuffer(callback: (line: string) => void): {
  feed(chunk: Buffer | string): void;
  flush(): void;
} {
  let buffer = "";
  return {
    feed(chunk: Buffer | string) {
      const raw = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      buffer += raw;
      const lines = buffer.split("\n");
      // Last element is either empty (line ended with \n) or a partial line
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          callback(trimmed);
        }
      }
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) {
        callback(trimmed);
      }
      buffer = "";
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Internal helpers                                                          */
/* -------------------------------------------------------------------------- */

function sseLine(data: string): string {
  return `${data}\n\n`;
}

/** OpenAI Responses streaming uses an `event:` line plus `data:` JSON (SDKs route on the event name). */
function dataEvent(state: StreamingConversionState, obj: Record<string, unknown>): string {
  const eventType = typeof obj.type === "string" ? obj.type : "message";
  const json = JSON.stringify({ ...obj, sequence_number: state.seq++ });
  return `event: ${eventType}\ndata: ${json}\n\n`;
}

function inProgressResponseShell(state: StreamingConversionState): Record<string, unknown> {
  return {
    id: state.responseId,
    object: "response",
    created_at: state.createdAt,
    model: state.model,
    status: "in_progress",
    error: null,
    incomplete_details: null,
    output: [],
    ...mergedResponseShellEcho(state.echo),
    usage: null,
  };
}

function emitResponseCreated(state: StreamingConversionState): string[] {
  const response = inProgressResponseShell(state);
  return [
    dataEvent(state, {
      type: "response.created",
      response,
    }),
    dataEvent(state, {
      type: "response.in_progress",
      response: { ...response },
    }),
  ];
}

function emitOutputItemAdded(
  state: StreamingConversionState,
  itemType: "message" | "function_call",
  toolIndex?: number
): string[] {
  if (itemType === "message") {
    return [
      dataEvent(state, {
        type: "response.output_item.added",
        item: {
          type: "message",
          id: state.messageId,
          role: "assistant",
          status: "in_progress",
          content: [],
        },
        output_index: state.outputIndex,
      }),
    ];
  }

  const tool = state.toolCalls[toolIndex ?? 0];
  return [
    dataEvent(state, {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: tool.id,
        name: tool.name,
        call_id: tool.callId,
        status: "in_progress",
        arguments: "",
      },
      output_index: state.outputIndex,
    }),
  ];
}

function emitContentPartAdded(
  state: StreamingConversionState,
  itemId: string,
  partType: "output_text"
): string[] {
  return [
    dataEvent(state, {
      type: "response.content_part.added",
      item_id: itemId,
      content_index: 0,
      output_index: state.outputIndex,
      part: { type: partType, text: "", annotations: [] },
    }),
  ];
}

function emitContentPartDone(
  state: StreamingConversionState,
  itemId: string,
  partType: "output_text",
  text: string
): string[] {
  return [
    dataEvent(state, {
      type: "response.content_part.done",
      item_id: itemId,
      content_index: 0,
      output_index: state.outputIndex,
      part: { type: partType, text, annotations: [] },
    }),
  ];
}

function emitTextDeltasForItem(
  state: StreamingConversionState,
  itemId: string,
  content: string
): string[] {
  const events: string[] = [];
  for (let i = 0; i < content.length; i += SSE_TEXT_CHUNK) {
    const delta = content.slice(i, i + SSE_TEXT_CHUNK);
    events.push(
      dataEvent(state, {
        type: "response.output_text.delta",
        item_id: itemId,
        content_index: 0,
        output_index: state.outputIndex,
        delta,
        logprobs: [],
      })
    );
  }
  return events;
}

function emitTextDoneForItem(
  state: StreamingConversionState,
  itemId: string,
  text: string
): string[] {
  return [
    dataEvent(state, {
      type: "response.output_text.done",
      item_id: itemId,
      content_index: 0,
      output_index: state.outputIndex,
      text,
      logprobs: [],
    }),
  ];
}

function emitTextDone(state: StreamingConversionState): string[] {
  return [
    ...emitTextDoneForItem(state, state.messageId, state.accumulatedText),
    ...emitContentPartDone(state, state.messageId, "output_text", state.accumulatedText),
  ];
}

/** OpenAI Responses API: MiMo reasoning_content maps to reasoning_text, not summary_text/output_text. */
function buildReasoningCompletedPayload(reasoningText: string): {
  summary: Array<{ text: string; type: "summary_text" }>;
  content: Array<{ text: string; type: "reasoning_text" }>;
} {
  if (!reasoningText) {
    return { summary: [], content: [] };
  }
  const text = reasoningText;
  return {
    summary: [],
    content: [{ type: "reasoning_text", text }],
  };
}

function emitReasoningItemAdded(state: StreamingConversionState): string[] {
  return [
    dataEvent(state, {
      type: "response.output_item.added",
      item: {
        type: "reasoning",
        id: state.reasoningId,
        status: "in_progress",
        summary: [],
        content: [],
      },
      output_index: state.outputIndex,
    }),
  ];
}

function emitReasoningTextDeltas(state: StreamingConversionState, content: string): string[] {
  const events: string[] = [];
  for (let i = 0; i < content.length; i += SSE_TEXT_CHUNK) {
    const delta = content.slice(i, i + SSE_TEXT_CHUNK);
    events.push(
      dataEvent(state, {
        type: "response.reasoning_text.delta",
        item_id: state.reasoningId,
        output_index: state.outputIndex,
        content_index: 0,
        delta,
      })
    );
  }
  return events;
}

function emitReasoningTextDone(state: StreamingConversionState): string[] {
  return [
    dataEvent(state, {
      type: "response.reasoning_text.done",
      item_id: state.reasoningId,
      output_index: state.outputIndex,
      content_index: 0,
      text: state.accumulatedReasoning,
    }),
  ];
}

function emitReasoningItemDone(state: StreamingConversionState): string[] {
  const { summary, content } = buildReasoningCompletedPayload(state.accumulatedReasoning);
  return [
    dataEvent(state, {
      type: "response.output_item.done",
      item: {
        type: "reasoning",
        id: state.reasoningId,
        status: "completed",
        summary,
        content,
      },
      output_index: state.outputIndex,
    }),
  ];
}

function buildMessageContent(state: StreamingConversionState): unknown[] {
  const content: unknown[] = [];
  if (state.accumulatedText) {
    content.push({
      type: "output_text",
      text: state.accumulatedText,
      annotations: [],
      logprobs: [],
    });
  }
  return content;
}

function emitOutputItemDone(
  state: StreamingConversionState,
  itemType: "message" | "function_call",
  toolIndex?: number
): string[] {
  if (itemType === "message") {
    return [
      dataEvent(state, {
        type: "response.output_item.done",
        item: {
          type: "message",
          id: state.messageId,
          role: "assistant",
          status: "completed",
          content: buildMessageContent(state),
        },
        output_index: state.outputIndex,
      }),
    ];
  }

  const tool = state.toolCalls[toolIndex ?? 0];
  return [
    dataEvent(state, {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: tool.id,
        name: tool.name,
        call_id: tool.callId,
        status: "completed",
        arguments: tool.arguments,
      },
      output_index: state.outputIndex,
    }),
  ];
}

function emitFunctionCallArgDeltas(
  state: StreamingConversionState,
  toolIndex: number,
  argsDelta: string
): string[] {
  const tool = state.toolCalls[toolIndex];
  const events: string[] = [];
  for (let i = 0; i < argsDelta.length; i += SSE_TEXT_CHUNK) {
    const delta = argsDelta.slice(i, i + SSE_TEXT_CHUNK);
    events.push(
      dataEvent(state, {
        type: "response.function_call_arguments.delta",
        item_id: tool.id,
        output_index: state.outputIndex,
        delta,
      })
    );
  }
  return events;
}

function emitFunctionCallArgDone(state: StreamingConversionState, toolIndex: number): string[] {
  const tool = state.toolCalls[toolIndex];
  return [
    dataEvent(state, {
      type: "response.function_call_arguments.done",
      item_id: tool.id,
      output_index: state.outputIndex,
      name: tool.name,
      arguments: tool.arguments,
    }),
  ];
}

function emitPendingToolCallCloseEvents(state: StreamingConversionState): string[] {
  const events: string[] = [];
  for (let i = 0; i < state.toolCalls.length; i++) {
    events.push(...emitFunctionCallArgDone(state, i));
    events.push(...emitOutputItemDone(state, "function_call", i));
    state.outputIndex++;
  }
  return events;
}

function emitResponseCompleted(state: StreamingConversionState): string[] {
  const output: unknown[] = [];

  // Reasoning output item (before message)
  if (state.accumulatedReasoning) {
    const { summary, content } = buildReasoningCompletedPayload(state.accumulatedReasoning);
    output.push({
      type: "reasoning",
      id: state.reasoningId,
      status: "completed",
      summary,
      content,
    });
  }

  const messageContent = buildMessageContent(state);
  if (messageContent.length > 0) {
    output.push({
      type: "message",
      id: state.messageId,
      role: "assistant",
      status: "completed",
      content: messageContent,
    });
  }

  for (const tool of state.toolCalls) {
    output.push({
      type: "function_call",
      id: tool.id,
      name: tool.name,
      call_id: tool.callId,
      status: "completed",
      arguments: tool.arguments,
    });
  }

  return [
    dataEvent(state, {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.createdAt,
        completed_at: Math.floor(Date.now() / 1000),
        model: state.model,
        status: "completed",
        error: null,
        incomplete_details: null,
        output,
        ...mergedResponseShellEcho(state.echo),
        usage: state.usage ?? null,
      },
    }),
  ];
}

/**
 * Flush pending completion events if the stream ended without a [DONE] or finish_reason.
 */
function flushCompletion(state: StreamingConversionState): string[] {
  if (state.phase === "done") {
    return []; // Already completed — avoid duplicate [DONE]
  }

  // finish_reason received; close deferred tool items, then complete.
  if (state.phase === "finished") {
    const events: string[] = [];
    if (state.toolsPendingClose) {
      events.push(...emitPendingToolCallCloseEvents(state));
      state.toolsPendingClose = false;
    }
    events.push(...emitResponseCompleted(state), sseLine("data: [DONE]"));
    state.phase = "done";
    return events;
  }

  const events: string[] = [];

  if (state.phase === "initial") {
    events.push(...emitResponseCreated(state));
    events.push(...emitResponseCompleted(state));
  } else if (state.phase === "created") {
    events.push(...emitResponseCompleted(state));
  } else if (state.phase === "reasoning") {
    events.push(...emitReasoningTextDone(state));
    events.push(...emitReasoningItemDone(state));
    state.outputIndex++;
    events.push(...emitResponseCompleted(state));
  } else if (state.phase === "text") {
    events.push(...emitTextDone(state));
    events.push(...emitOutputItemDone(state, "message"));
    state.outputIndex++;
    events.push(...emitResponseCompleted(state));
  } else if (state.phase === "tool") {
    events.push(...emitPendingToolCallCloseEvents(state));
    events.push(...emitResponseCompleted(state));
  }

  events.push(sseLine("data: [DONE]"));
  state.phase = "done";
  return events;
}
