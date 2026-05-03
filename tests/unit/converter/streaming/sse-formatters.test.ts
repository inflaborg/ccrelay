/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import { convertChatCompletionToResponses } from "@/converter/adapters/openai-chat-to-responses";
import { formatOpenAIResponsesSse } from "@/converter/streaming/sse-formatters";
import type { OpenAIChatCompletionResponse } from "@/converter/adapters/openai-chat-to-anthropic-response";
import { extractResponsesEcho } from "@/converter/adapters/openai-responses-to-chat";

function parseSseDataEvents(sse: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of sse.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed || trimmed === "data: [DONE]") {
      continue;
    }
    const lines = trimmed.split("\n");
    const dataLine = lines.find(l => l.startsWith("data: "));
    if (!dataLine || dataLine.trim() === "data: [DONE]") {
      continue;
    }
    const json = dataLine.slice("data: ".length).trimStart();
    out.push(JSON.parse(json) as Record<string, unknown>);
  }
  return out;
}

describe("formatOpenAIResponsesSse", () => {
  it("emits text deltas, output item lifecycle, response.completed, and [DONE] for assistant text", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    const sse = formatOpenAIResponsesSse(r);
    const events = parseSseDataEvents(sse);
    expect(events.some((e: Record<string, unknown>) => e.type === "response.created")).toBe(true);
    expect(events.some((e: Record<string, unknown>) => e.type === "response.in_progress")).toBe(
      true
    );
    expect(
      events.some(
        (e: Record<string, unknown>) =>
          e.type === "response.created" &&
          typeof e.response === "object" &&
          e.response !== null &&
          JSON.stringify(e.response).includes('"in_progress"')
      )
    ).toBe(true);
    expect(
      events.some((e: Record<string, unknown>) => e.type === "response.output_item.added")
    ).toBe(true);
    expect(
      events.some(
        (e: Record<string, unknown>) =>
          e.type === "response.output_text.delta" && JSON.stringify(e).includes('"delta":"Hi"')
      )
    ).toBe(true);
    expect(
      events.some((e: Record<string, unknown>) => e.type === "response.output_text.done")
    ).toBe(true);
    expect(
      events.some((e: Record<string, unknown>) => e.type === "response.output_item.done")
    ).toBe(true);
    expect(
      events.some(
        (e: Record<string, unknown>) =>
          e.type === "response.completed" && JSON.stringify(e).includes('"completed"')
      )
    ).toBe(true);
    expect(sse.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("emits per-item events for text plus function_call (two output_item.added, argument deltas, two done)", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Call the tool",
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: { name: "get_weather", arguments: JSON.stringify({ city: "NYC" }) },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    expect(r.output.length).toBe(2);
    const sse = formatOpenAIResponsesSse(r);
    const events = parseSseDataEvents(sse);
    const added = events.filter((e: { type?: string }) => e.type === "response.output_item.added");
    expect(added).toHaveLength(2);
    const msgAdded = added[0] as { item?: { type?: string } };
    const fcAdded = added[1] as { item?: { type?: string; status?: string; arguments?: string } };
    expect(msgAdded.item?.type).toBe("message");
    expect(fcAdded.item?.type).toBe("function_call");
    expect(fcAdded.item?.status).toBe("in_progress");
    expect(fcAdded.item?.arguments).toBe("");

    expect(
      events.some((e: { type?: string }) => e.type === "response.function_call_arguments.delta")
    ).toBe(true);
    const fcDone = events.find(
      (e: { type?: string }) => e.type === "response.function_call_arguments.done"
    );
    expect(fcDone).toBeDefined();
    expect(fcDone?.["arguments"]).toBe(JSON.stringify({ city: "NYC" }));
    const itemDones = events.filter(
      (e: { type?: string }) => e.type === "response.output_item.done"
    );
    expect(itemDones).toHaveLength(2);
    expect((itemDones[1] as { item?: { type?: string; name?: string } }).item?.type).toBe(
      "function_call"
    );
    expect((itemDones[1] as { item?: { name?: string } }).item?.name).toBe("get_weather");
  });

  it("emits function_call stream events for tool_call-only completion (not minimal two-line path)", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-y",
      object: "chat.completion",
      created: 1700000000,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_solo",
                type: "function",
                function: { name: "only_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    expect(r.output.length).toBe(1);
    const sse = formatOpenAIResponsesSse(r);
    const events = parseSseDataEvents(sse);
    const added = events.filter((e: { type?: string }) => e.type === "response.output_item.added");
    expect(added).toHaveLength(1);
    expect((added[0] as { item?: { type?: string } }).item?.type).toBe("function_call");
    expect(
      events.some((e: { type?: string }) => e.type === "response.function_call_arguments.done")
    ).toBe(true);
    expect(events.some((e: { type?: string }) => e.type === "response.output_text.delta")).toBe(
      false
    );
    expect(events.length).toBeGreaterThan(3);
  });

  it("includes echoed tools/reasoning in synthetic SSE response shells", () => {
    const echo = extractResponsesEcho({
      tools: [{ type: "function", name: "echo_tool", parameters: { type: "object" } }],
      reasoning: { effort: "low", summary: "auto" },
      parallel_tool_calls: false,
    });
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
    };
    const r = convertChatCompletionToResponses(chat, "m", echo);
    const sse = formatOpenAIResponsesSse(r);
    const events = parseSseDataEvents(sse);
    const created = events.find((e: Record<string, unknown>) => e.type === "response.created") as {
      response?: {
        tools?: unknown[];
        reasoning?: { effort?: string };
        parallel_tool_calls?: boolean;
      };
    };
    expect(created?.response?.tools).toHaveLength(1);
    expect(created?.response?.reasoning?.effort).toBe("low");
    expect(created?.response?.parallel_tool_calls).toBe(false);
    const completed = events.find(
      (e: Record<string, unknown>) => e.type === "response.completed"
    ) as {
      response?: { tools?: unknown[] };
    };
    expect(completed?.response?.tools).toHaveLength(1);
  });
});
