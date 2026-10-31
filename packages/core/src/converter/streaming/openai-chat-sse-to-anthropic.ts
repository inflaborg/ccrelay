/**
 * OpenAI Chat Completions SSE (`data:` payloads) → Anthropic Messages SSE events.
 *
 * Feed one upstream `data:` payload at a time; each call returns zero or more complete
 * Anthropic SSE event strings. Usage and the final `message_delta` are deferred until
 * `[DONE]` (or `flush` at end of stream) so a trailing usage-only chunk is included.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";

import { formatAnthropicSseError } from "./sse-formatters";

type OpenBlock =
  | { kind: "text"; index: number }
  | { kind: "thinking"; index: number }
  | { kind: "tool_use"; index: number; toolIndex: number };

interface ToolState {
  id: string;
  name: string;
  /** Argument fragments received before the tool name (block cannot open yet). */
  pendingArgs: string;
  blockIndex?: number;
}

export interface OpenAIChatToAnthropicSseState {
  messageId: string;
  /** Client-facing model id echoed in `message_start`. */
  model: string;
  started: boolean;
  finished: boolean;
  nextBlockIndex: number;
  open: OpenBlock | null;
  tools: Map<number, ToolState>;
  hadToolUse: boolean;
  /** Thinking signature to attach before the thinking block closes. */
  pendingSignature?: string;
  finishReason?: string;
  /** Set when the upstream stream carried an `error` payload (already emitted as `event: error`). */
  errorMessage?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
  };
}

export function createOpenAIChatToAnthropicSseState(model: string): OpenAIChatToAnthropicSseState {
  return {
    messageId: `msg_${randomUUID().replace(/-/g, "")}`,
    model: model || "",
    started: false,
    finished: false,
    nextBlockIndex: 0,
    open: null,
    tools: new Map(),
    hadToolUse: false,
  };
}

function event(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

function ensureStarted(state: OpenAIChatToAnthropicSseState, out: string[]): void {
  if (state.started) {
    return;
  }
  state.started = true;
  out.push(
    event("message_start", {
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })
  );
}

function closeOpenBlock(state: OpenAIChatToAnthropicSseState, out: string[]): void {
  const open = state.open;
  if (!open) {
    return;
  }
  if (open.kind === "thinking" && state.pendingSignature) {
    out.push(
      event("content_block_delta", {
        type: "content_block_delta",
        index: open.index,
        delta: { type: "signature_delta", signature: state.pendingSignature },
      })
    );
    state.pendingSignature = undefined;
  }
  out.push(event("content_block_stop", { type: "content_block_stop", index: open.index }));
  state.open = null;
}

function openBlock(
  state: OpenAIChatToAnthropicSseState,
  out: string[],
  contentBlock: Record<string, unknown>
): number {
  closeOpenBlock(state, out);
  const index = state.nextBlockIndex++;
  out.push(
    event("content_block_start", {
      type: "content_block_start",
      index,
      content_block: contentBlock,
    })
  );
  return index;
}

function emitThinking(state: OpenAIChatToAnthropicSseState, out: string[], text: string): void {
  if (state.open?.kind !== "thinking") {
    const index = openBlock(state, out, { type: "thinking", thinking: "" });
    state.open = { kind: "thinking", index };
  }
  if (text) {
    out.push(
      event("content_block_delta", {
        type: "content_block_delta",
        index: state.open.index,
        delta: { type: "thinking_delta", thinking: text },
      })
    );
  }
}

function emitText(state: OpenAIChatToAnthropicSseState, out: string[], text: string): void {
  if (state.open?.kind !== "text") {
    const index = openBlock(state, out, { type: "text", text: "" });
    state.open = { kind: "text", index };
  }
  out.push(
    event("content_block_delta", {
      type: "content_block_delta",
      index: state.open.index,
      delta: { type: "text_delta", text },
    })
  );
}

function emitToolArgs(out: string[], blockIndex: number, partial: string): void {
  if (!partial) {
    return;
  }
  out.push(
    event("content_block_delta", {
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "input_json_delta", partial_json: partial },
    })
  );
}

function openToolBlock(
  state: OpenAIChatToAnthropicSseState,
  out: string[],
  toolIndex: number,
  tool: ToolState
): void {
  const index = openBlock(state, out, {
    type: "tool_use",
    id: tool.id || `toolu_${randomUUID().replace(/-/g, "")}`,
    name: tool.name,
    input: {},
  });
  tool.blockIndex = index;
  state.open = { kind: "tool_use", index, toolIndex };
  state.hadToolUse = true;
  emitToolArgs(out, index, tool.pendingArgs);
  tool.pendingArgs = "";
}

function handleToolCallDelta(
  state: OpenAIChatToAnthropicSseState,
  out: string[],
  raw: Record<string, unknown>,
  position: number
): void {
  const toolIndex = typeof raw.index === "number" ? raw.index : position;
  const fn = asRecord(raw.function);
  let tool = state.tools.get(toolIndex);
  if (!tool) {
    tool = { id: "", name: "", pendingArgs: "" };
    state.tools.set(toolIndex, tool);
  }
  if (typeof raw.id === "string" && raw.id && !tool.id) {
    tool.id = raw.id;
  }
  if (fn && typeof fn.name === "string" && fn.name && !tool.name) {
    tool.name = fn.name;
  }
  const args = fn && typeof fn.arguments === "string" ? fn.arguments : "";

  if (tool.blockIndex === undefined) {
    if (!tool.name) {
      tool.pendingArgs += args;
      return;
    }
    tool.pendingArgs += args;
    openToolBlock(state, out, toolIndex, tool);
    return;
  }
  emitToolArgs(out, tool.blockIndex, args);
}

function mapStopReason(state: OpenAIChatToAnthropicSseState): string {
  switch (state.finishReason) {
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return state.hadToolUse ? "tool_use" : "end_turn";
  }
}

function recordUsage(state: OpenAIChatToAnthropicSseState, raw: Record<string, unknown>): void {
  const details = asRecord(raw.prompt_tokens_details);
  state.usage = {
    prompt_tokens: typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : undefined,
    completion_tokens:
      typeof raw.completion_tokens === "number" ? raw.completion_tokens : undefined,
    cached_tokens: typeof details?.cached_tokens === "number" ? details.cached_tokens : undefined,
  };
}

/**
 * Close any open block and emit `message_delta` + `message_stop`. Idempotent.
 * Tools that never received a name are opened with an empty name so arguments are not lost.
 */
export function flushOpenAIChatToAnthropicSse(state: OpenAIChatToAnthropicSseState): string[] {
  if (state.finished) {
    return [];
  }
  const out: string[] = [];
  ensureStarted(state, out);
  for (const [toolIndex, tool] of state.tools) {
    if (tool.blockIndex === undefined && tool.pendingArgs) {
      openToolBlock(state, out, toolIndex, tool);
    }
  }
  closeOpenBlock(state, out);

  const prompt = state.usage?.prompt_tokens ?? 0;
  const cached = state.usage?.cached_tokens ?? 0;
  out.push(
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: mapStopReason(state), stop_sequence: null },
      usage: {
        input_tokens: Math.max(0, prompt - cached),
        output_tokens: state.usage?.completion_tokens ?? 0,
        cache_read_input_tokens: cached,
      },
    })
  );
  out.push(event("message_stop", { type: "message_stop" }));
  state.finished = true;
  return out;
}

/**
 * Process one upstream payload (the text after `data:`). `[DONE]` finalizes the message.
 * A top-level `{"error": ...}` payload becomes an Anthropic `event: error` and ends the stream.
 */
export function processOpenAIChatSseChunkToAnthropic(
  state: OpenAIChatToAnthropicSseState,
  payload: string
): string[] {
  if (state.finished) {
    return [];
  }
  const trimmed = payload.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === "[DONE]") {
    return flushOpenAIChatToAnthropicSse(state);
  }

  let chunk: Record<string, unknown> | undefined;
  try {
    chunk = asRecord(JSON.parse(trimmed));
  } catch {
    return [];
  }
  if (!chunk) {
    return [];
  }

  const out: string[] = [];

  const err = asRecord(chunk.error);
  if (err) {
    const message =
      typeof err.message === "string" && err.message ? err.message : JSON.stringify(err);
    const type = typeof err.type === "string" && err.type ? err.type : "api_error";
    closeOpenBlock(state, out);
    out.push(formatAnthropicSseError(0, message, type));
    state.errorMessage = message;
    state.finished = true;
    return out;
  }

  const usage = asRecord(chunk.usage);
  if (usage) {
    recordUsage(state, usage);
  }

  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return out;
  }
  const choice = asRecord(choices[0]);
  if (!choice) {
    return out;
  }
  ensureStarted(state, out);

  const delta = asRecord(choice.delta);
  if (delta) {
    const thinking = asRecord(delta.thinking);
    const reasoningText =
      (typeof delta.reasoning_content === "string" ? delta.reasoning_content : "") +
      (typeof thinking?.content === "string" ? thinking.content : "");
    if (reasoningText) {
      emitThinking(state, out, reasoningText);
    }
    if (typeof thinking?.signature === "string" && thinking.signature) {
      if (state.open?.kind !== "thinking") {
        emitThinking(state, out, "");
      }
      state.pendingSignature = thinking.signature;
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      emitText(state, out, delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((raw, position) => {
        const tc = asRecord(raw);
        if (tc) {
          handleToolCallDelta(state, out, tc, position);
        }
      });
    }
  }

  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }

  return out;
}
