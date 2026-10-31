/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it } from "vitest";
import {
  createOpenAIChatToAnthropicSseState,
  flushOpenAIChatToAnthropicSse,
  processOpenAIChatSseChunkToAnthropic,
} from "@/converter/streaming/openai-chat-sse-to-anthropic";

interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseEvents(raw: string[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const block of raw.join("").split("\n\n")) {
    if (!block.trim()) {
      continue;
    }
    const lines = block.split("\n");
    const ev = lines.find(l => l.startsWith("event: "))?.slice(7) ?? "";
    const data = lines.find(l => l.startsWith("data: "))?.slice(6) ?? "{}";
    out.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    model: "gpt-x",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
}

function run(payloads: string[], model = "claude-sonnet"): ParsedEvent[] {
  const state = createOpenAIChatToAnthropicSseState(model);
  const out: string[] = [];
  for (const p of payloads) {
    out.push(...processOpenAIChatSseChunkToAnthropic(state, p));
  }
  out.push(...flushOpenAIChatToAnthropicSse(state));
  return parseEvents(out);
}

describe("openai-chat-sse-to-anthropic", () => {
  it("streams text deltas inside one text block and finishes with usage", () => {
    const events = run([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Hel" }),
      chunk({ content: "lo" }),
      chunk({}, "stop"),
      JSON.stringify({
        id: "chatcmpl-1",
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      }),
      "[DONE]",
    ]);

    expect(events.map(e => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const start = events[0].data.message as Record<string, unknown>;
    expect(start.model).toBe("claude-sonnet");
    expect(events[2].data.delta).toEqual({ type: "text_delta", text: "Hel" });
    const md = events[5].data;
    expect((md.delta as Record<string, unknown>).stop_reason).toBe("end_turn");
    expect(md.usage).toEqual({ input_tokens: 60, output_tokens: 7, cache_read_input_tokens: 40 });
  });

  it("emits thinking before text and closes thinking with a signature delta", () => {
    const events = run([
      chunk({ reasoning_content: "think " }),
      chunk({ thinking: { content: "more", signature: "sig-1" } }),
      chunk({ content: "answer" }),
      chunk({}, "stop"),
      "[DONE]",
    ]);
    const kinds = events.map(e =>
      e.event === "content_block_start"
        ? `start:${String((e.data.content_block as Record<string, unknown>).type)}`
        : e.event === "content_block_delta"
          ? `delta:${String((e.data.delta as Record<string, unknown>).type)}`
          : e.event
    );
    expect(kinds).toEqual([
      "message_start",
      "start:thinking",
      "delta:thinking_delta",
      "delta:thinking_delta",
      "delta:signature_delta",
      "content_block_stop",
      "start:text",
      "delta:text_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("maps multiple tool calls to sequential tool_use blocks with input_json_delta", () => {
    const events = run([
      chunk({ content: "Let me check." }),
      chunk({
        tool_calls: [
          { index: 0, id: "call_a", type: "function", function: { name: "read", arguments: "" } },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }),
      chunk({
        tool_calls: [
          { index: 1, id: "call_b", type: "function", function: { name: "ls", arguments: "{}" } },
        ],
      }),
      chunk({}, "tool_calls"),
      "[DONE]",
    ]);

    const starts = events.filter(e => e.event === "content_block_start");
    expect(starts.map(e => e.data.content_block)).toEqual([
      { type: "text", text: "" },
      { type: "tool_use", id: "call_a", name: "read", input: {} },
      { type: "tool_use", id: "call_b", name: "ls", input: {} },
    ]);
    const argsFor = (index: number) =>
      events
        .filter(
          e =>
            e.event === "content_block_delta" &&
            e.data.index === index &&
            (e.data.delta as Record<string, unknown>).type === "input_json_delta"
        )
        .map(e => (e.data.delta as Record<string, unknown>).partial_json)
        .join("");
    expect(argsFor(1)).toBe('{"path":"a.ts"}');
    expect(argsFor(2)).toBe("{}");
    const md = events.find(e => e.event === "message_delta")!;
    expect((md.data.delta as Record<string, unknown>).stop_reason).toBe("tool_use");
    expect(events.filter(e => e.event === "content_block_stop")).toHaveLength(3);
  });

  it("buffers tool arguments that arrive before the tool name", () => {
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_x", function: { arguments: '{"a"' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "fn", arguments: ":1}" } }] }),
      chunk({}, "tool_calls"),
      "[DONE]",
    ]);
    const start = events.find(e => e.event === "content_block_start")!;
    expect(start.data.content_block).toEqual({
      type: "tool_use",
      id: "call_x",
      name: "fn",
      input: {},
    });
    const args = events
      .filter(e => e.event === "content_block_delta")
      .map(e => (e.data.delta as Record<string, unknown>).partial_json)
      .join("");
    expect(args).toBe('{"a":1}');
  });

  it("turns a mid-stream error payload into an Anthropic error event and stops", () => {
    const state = createOpenAIChatToAnthropicSseState("m");
    const out = [
      ...processOpenAIChatSseChunkToAnthropic(state, chunk({ content: "partial" })),
      ...processOpenAIChatSseChunkToAnthropic(
        state,
        JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error" } })
      ),
      ...processOpenAIChatSseChunkToAnthropic(state, chunk({ content: "ignored" })),
      ...flushOpenAIChatToAnthropicSse(state),
    ];
    const events = parseEvents(out);
    const err = events.find(e => e.event === "error")!;
    expect(err.data).toEqual({
      type: "error",
      error: { type: "rate_limit_error", message: "rate limited" },
    });
    expect(events.at(-1)?.event).toBe("message_stop");
    expect(events.some(e => e.event === "message_delta")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("ignored");
  });

  it("finalizes on flush when the upstream ends without [DONE]", () => {
    const events = run([chunk({ content: "hi" }), chunk({}, "length")]);
    expect(events.at(-2)?.event).toBe("message_delta");
    expect(((events.at(-2)?.data.delta as Record<string, unknown>) ?? {}).stop_reason).toBe(
      "max_tokens"
    );
    expect(events.at(-1)?.event).toBe("message_stop");
  });

  it("emits a well-formed empty message when the stream has no choices", () => {
    const events = run(["[DONE]"]);
    expect(events.map(e => e.event)).toEqual(["message_start", "message_delta", "message_stop"]);
  });
});
