/**
 * Anthropic Messages API SSE (`data:` payloads) → OpenAI Chat Completions SSE (`data: {...}`)
 *
 * Streams client `tool_use` as OpenAI tool_calls; `server_tool_use` / server tool results become
 * opaque text deltas (`JSON.stringify`) — never OpenAI `tool_calls`.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { randomUUID } from "crypto";

function coerceStringField(val: unknown): string {
  if (typeof val === "string") {
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return "";
}

const SSE_TEXT_CHUNK = 64;

type BlockAccum =
  | { kind: "text" }
  | {
      kind: "tool_use";
      id: string;
      name: string;
      openAiTcIndex: number;
    }
  | { kind: "thinking"; signature?: string }
  | {
      kind: "server_tool_use";
      id: string;
      name: string;
      partialJson: string;
    }
  | { kind: "server_tool_result"; content: unknown };

export interface AnthropicToOpenAISseState {
  completionId: string;
  created: number;
  model: string;
  emittedRoleChunk: boolean;
  nextToolCallIndex: number;
  blocks: Map<number, BlockAccum>;
  hadClientToolUse: boolean;
  lastUsageAnthropic?: Record<string, unknown>;
  anthropicStopReason?: string | null;
  streamingFinished: boolean;
  thinkingSignatureEmitted: boolean;
}

export function createAnthropicToOpenAISseState(initialModel: string): AnthropicToOpenAISseState {
  return {
    completionId: `chatcmpl-${randomUUID().replace(/-/g, "")}`,
    created: Math.floor(Date.now() / 1000),
    model: initialModel || "",
    emittedRoleChunk: false,
    nextToolCallIndex: 0,
    blocks: new Map(),
    hadClientToolUse: false,
    streamingFinished: false,
    thinkingSignatureEmitted: false,
  };
}

function isServerLikeResultBlock(cb: Record<string, unknown>): boolean {
  const typ = cb.type;
  return typeof typ === "string" && typ !== "tool_result" && typeof cb.tool_use_id === "string";
}

function pushChatChunk(
  state: AnthropicToOpenAISseState,
  delta: Record<string, unknown>,
  finishReason: string | null = null
): string {
  return `data: ${JSON.stringify({
    id: state.completionId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function emitContentSlices(state: AnthropicToOpenAISseState, payload: string, out: string[]): void {
  for (let i = 0; i < payload.length; i += SSE_TEXT_CHUNK) {
    out.push(pushChatChunk(state, { content: payload.slice(i, i + SSE_TEXT_CHUNK) }));
  }
}

function mapFinishReason(anthropic: string | null | undefined, hadClientToolUse: boolean): string {
  if (anthropic === "tool_use") {
    return hadClientToolUse ? "tool_calls" : "stop";
  }
  if (anthropic === "max_tokens") {
    return "length";
  }
  return "stop";
}

/** Final chunks: finish_reason + usage + `[DONE]` */
export function flushAnthropicToOpenAISseFinal(state: AnthropicToOpenAISseState): string[] {
  if (state.streamingFinished) {
    return [];
  }
  state.streamingFinished = true;

  const lines: string[] = [];
  lines.push(
    pushChatChunk(state, {}, mapFinishReason(state.anthropicStopReason, state.hadClientToolUse))
  );

  const u = state.lastUsageAnthropic;
  if (u && typeof u === "object") {
    const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
    const cached = typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0;
    const out = typeof u.output_tokens === "number" ? u.output_tokens : 0;
    lines.push(
      `data: ${JSON.stringify({
        id: state.completionId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model || "",
        choices: [],
        usage: {
          prompt_tokens: input + cached,
          completion_tokens: out,
          total_tokens: input + cached + out,
          ...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
        },
      })}\n\n`
    );
  }

  lines.push("data: [DONE]\n\n");
  return lines;
}

/** One parsed SSE `data` JSON envelope from Anthropic. */
export function processAnthropicStreamEnvelope(
  state: AnthropicToOpenAISseState,
  envelope: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  const t = envelope.type as string | undefined;

  const ensureRole = (): void => {
    if (!state.emittedRoleChunk) {
      lines.push(pushChatChunk(state, { role: "assistant", content: "" }));
      state.emittedRoleChunk = true;
    }
  };

  switch (t) {
    case "message_start": {
      const msg = envelope.message as Record<string, unknown> | undefined;
      if (typeof msg?.model === "string" && msg.model) {
        state.model = msg.model;
      }
      ensureRole();
      break;
    }
    case "content_block_start": {
      ensureRole();
      const idx = envelope.index as number;
      const cb = (envelope.content_block as Record<string, unknown>) || {};
      const blockType = coerceStringField(cb.type);
      if (blockType === "text") {
        state.blocks.set(idx, { kind: "text" });
      } else if (blockType === "tool_use") {
        state.hadClientToolUse = true;
        const tcIdx = state.nextToolCallIndex++;
        const id = coerceStringField(cb.id);
        const name = coerceStringField(cb.name);
        state.blocks.set(idx, { kind: "tool_use", id, name, openAiTcIndex: tcIdx });
        lines.push(
          pushChatChunk(state, {
            tool_calls: [
              {
                index: tcIdx,
                id,
                type: "function",
                function: { name, arguments: "" },
              },
            ],
          })
        );
      } else if (blockType === "thinking") {
        state.blocks.set(idx, { kind: "thinking" });
      } else if (blockType === "server_tool_use") {
        state.blocks.set(idx, {
          kind: "server_tool_use",
          id: coerceStringField(cb.id),
          name: coerceStringField(cb.name),
          partialJson: "",
        });
      } else if (isServerLikeResultBlock(cb)) {
        state.blocks.set(idx, { kind: "server_tool_result", content: cb.content });
      }
      break;
    }
    case "content_block_delta": {
      ensureRole();
      const idx = envelope.index as number;
      const deltaWrap = envelope.delta as Record<string, unknown> | undefined;
      const deltaType = coerceStringField(deltaWrap?.type);
      const block = state.blocks.get(idx);
      if (!block || !deltaWrap) {
        break;
      }

      if (block.kind === "text" && deltaType === "text_delta") {
        const text = typeof deltaWrap.text === "string" ? deltaWrap.text : "";
        emitContentSlices(state, text, lines);
      } else if (block.kind === "thinking") {
        if (deltaType === "signature_delta" && typeof deltaWrap.signature === "string") {
          block.signature = deltaWrap.signature;
        }
        if (deltaType === "thinking_delta" && typeof deltaWrap.thinking === "string") {
          const slice = deltaWrap.thinking;
          let sigEmitted = state.thinkingSignatureEmitted;
          for (let i = 0; i < slice.length; i += SSE_TEXT_CHUNK) {
            const innerCh: { content: string; signature?: string } = {
              content: slice.slice(i, i + SSE_TEXT_CHUNK),
            };
            if (block.signature && !sigEmitted) {
              innerCh.signature = block.signature;
              sigEmitted = true;
            }
            lines.push(pushChatChunk(state, { thinking: innerCh }));
          }
          state.thinkingSignatureEmitted = sigEmitted;
        }
      } else if (block.kind === "tool_use" && deltaType === "input_json_delta") {
        const p = typeof deltaWrap.partial_json === "string" ? deltaWrap.partial_json : "";
        for (let i = 0; i < p.length; i += SSE_TEXT_CHUNK) {
          lines.push(
            pushChatChunk(state, {
              tool_calls: [
                {
                  index: block.openAiTcIndex,
                  function: { arguments: p.slice(i, i + SSE_TEXT_CHUNK) },
                },
              ],
            })
          );
        }
      } else if (block.kind === "server_tool_use" && deltaType === "input_json_delta") {
        const p = typeof deltaWrap.partial_json === "string" ? deltaWrap.partial_json : "";
        block.partialJson += p;
      }
      break;
    }
    case "content_block_stop": {
      ensureRole();
      const idx = envelope.index as number;
      const block = state.blocks.get(idx);
      if (!block) {
        break;
      }
      if (block.kind === "server_tool_use") {
        let input: Record<string, unknown> = {};
        try {
          input =
            block.partialJson.trim() !== ""
              ? (JSON.parse(block.partialJson) as Record<string, unknown>)
              : {};
        } catch {
          input = {};
        }
        const payload = JSON.stringify({
          type: "server_tool_use",
          id: block.id,
          name: block.name,
          input,
        });
        emitContentSlices(state, payload, lines);
      } else if (block.kind === "server_tool_result") {
        emitContentSlices(state, JSON.stringify(block.content), lines);
      }
      state.blocks.delete(idx);
      break;
    }
    case "message_delta": {
      const d = envelope.delta as Record<string, unknown> | undefined;
      if (d && Object.prototype.hasOwnProperty.call(d, "stop_reason")) {
        state.anthropicStopReason = typeof d.stop_reason === "string" ? d.stop_reason : null;
      }
      const u = envelope.usage;
      if (u && typeof u === "object" && !Array.isArray(u)) {
        state.lastUsageAnthropic = u as Record<string, unknown>;
      }
      break;
    }
    case "message_stop":
      lines.push(...flushAnthropicToOpenAISseFinal(state));
      break;
    default:
      break;
  }

  return lines;
}

/**
 * Buffer upstream Anthropic SSE; blank-line-terminated frames merge `data:` lines then JSON.parse.
 */
export function createAnthropicSseEnvelopeBuffer(
  onEnvelope: (data: Record<string, unknown>) => void
): { push(chunk: Buffer | string): void; flush(): void } {
  let lineRemainder = "";

  const pendingDataLines: string[] = [];

  const flushFrame = (): void => {
    if (pendingDataLines.length === 0) {
      return;
    }
    const merged = pendingDataLines.join("\n");
    pendingDataLines.length = 0;
    try {
      onEnvelope(JSON.parse(merged.trim()) as Record<string, unknown>);
    } catch {
      /* ignore malformed */
    }
  };

  const consumeLine = (raw: string): void => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.trim()) {
      flushFrame();
      return;
    }
    if (line.startsWith("data:")) {
      pendingDataLines.push(line.slice("data:".length).trimStart());
    }
    /* discard `event:`, comments, pings */
  };

  return {
    push(chunk: Buffer | string): void {
      lineRemainder += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (;;) {
        const nl = lineRemainder.indexOf("\n");
        if (nl < 0) {
          break;
        }
        const rawLine = lineRemainder.slice(0, nl);
        lineRemainder = lineRemainder.slice(nl + 1);
        consumeLine(rawLine);
      }
    },
    flush(): void {
      if (lineRemainder.trim().length > 0) {
        consumeLine(lineRemainder);
        lineRemainder = "";
      }
      flushFrame();
    },
  };
}
