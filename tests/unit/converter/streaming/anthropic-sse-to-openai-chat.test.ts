/* eslint-disable @typescript-eslint/naming-convention -- Anthropic SSE uses snake_case */
import { describe, it, expect } from "vitest";
import {
  createAnthropicSseEnvelopeBuffer,
  createAnthropicToOpenAISseState,
  flushAnthropicToOpenAISseFinal,
  processAnthropicStreamEnvelope,
} from "@/converter/streaming/anthropic-sse-to-openai-chat";

type ParsedChatChunkChoice = {
  delta?: { content?: string; tool_calls?: unknown };
  finish_reason?: string | null;
};

function firstChoice(chunk: Record<string, unknown>): ParsedChatChunkChoice | undefined {
  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  return choices[0] as ParsedChatChunkChoice;
}

function findLastChunkWhere(
  chunks: Record<string, unknown>[],
  pred: (ch: ParsedChatChunkChoice | undefined) => boolean
): Record<string, unknown> | undefined {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c && pred(firstChoice(c))) {
      return c;
    }
  }
  return undefined;
}

describe("converter: anthropic SSE → OpenAI chat completion chunks", () => {
  function parseChunks(sseLines: string): Array<Record<string, unknown>> {
    const state = createAnthropicToOpenAISseState("");
    const out: string[] = [];
    const buf = createAnthropicSseEnvelopeBuffer(env => {
      out.push(...processAnthropicStreamEnvelope(state, env));
    });
    buf.push(sseLines);
    buf.flush();
    return out
      .filter(l => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map(l => JSON.parse(l.slice("data: ".length).trimEnd()) as Record<string, unknown>);
  }

  it("streams client tool_use as tool_calls deltas, not plain content", () => {
    const state = createAnthropicToOpenAISseState("upstream");
    const lines: string[] = [];
    const feed = createAnthropicSseEnvelopeBuffer(env => {
      lines.push(...processAnthropicStreamEnvelope(state, env));
    });
    feed.push(
      `data: ${JSON.stringify({
        type: "message_start",
        message: { model: "claude-sonnet-4-20250514" },
      })}\n\n`
    );
    feed.push(
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "get_weather" },
      })}\n\n`
    );
    feed.push(
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":"Paris"}' },
      })}\n\n`
    );
    feed.push(
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } })}\n\n`
    );
    feed.push(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    feed.flush();

    const deltas = lines
      .filter(l => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map(l => JSON.parse(l.slice("data: ".length)) as Record<string, unknown>);
    expect(deltas.some(d => firstChoice(d)?.delta?.tool_calls !== undefined)).toBe(true);
    const lastFinish = findLastChunkWhere(deltas, ch => typeof ch?.finish_reason === "string");
    expect(lastFinish && firstChoice(lastFinish)?.finish_reason).toBe("tool_calls");
  });

  it("emits server_tool_use as opaque content chunks, never as tool_calls", () => {
    const sse = [
      JSON.stringify({
        type: "message_start",
        message: { model: "claude-3" },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 0,
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "server_tool_use", id: "s1", name: "web_search" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({ query: "q" }),
        },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 1,
      }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0 },
      }),
      JSON.stringify({ type: "message_stop" }),
    ]
      .map(j => `data: ${j}\n\n`)
      .join("");

    const chunks = parseChunks(sse);
    expect(
      chunks.some(c => {
        const delta = firstChoice(c)?.delta;
        return delta?.tool_calls !== undefined;
      })
    ).toBe(false);

    const joined = chunks.map(c => firstChoice(c)?.delta?.content ?? "").join("");
    expect(joined).toContain("Hi");
    expect(joined).toContain(
      JSON.stringify({
        type: "server_tool_use",
        id: "s1",
        name: "web_search",
        input: { query: "q" },
      })
    );

    const finish = findLastChunkWhere(chunks, ch => typeof ch?.finish_reason === "string");
    expect(finish && firstChoice(finish)?.finish_reason).toBe("stop");
  });

  it("serializes server tool result block content as JSON text at content_block_stop", () => {
    const sse = [
      JSON.stringify({
        type: "message_start",
        message: { model: "claude-3" },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [{ type: "web_search_result", url: "https://a", title: "t" }],
        },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      }),
      JSON.stringify({ type: "message_stop" }),
    ]
      .map(j => `data: ${j}\n\n`)
      .join("");
    const state = createAnthropicToOpenAISseState("");
    const lines: string[] = [];
    const buf = createAnthropicSseEnvelopeBuffer(env => {
      lines.push(...processAnthropicStreamEnvelope(state, env));
    });
    buf.push(sse);
    buf.flush();

    expect(
      lines.some(l => {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) {
          return false;
        }
        const d = JSON.parse(l.slice("data: ".length)) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = d.choices?.[0]?.delta?.content ?? "";
        return piece.includes("web_search_result") && piece.includes("https://a");
      })
    ).toBe(true);
  });

  it("flushAnthropicToOpenAISseFinal is idempotent", () => {
    const state = createAnthropicToOpenAISseState("m");
    expect(flushAnthropicToOpenAISseFinal(state).length).toBeGreaterThan(0);
    expect(flushAnthropicToOpenAISseFinal(state)).toEqual([]);
  });
});
