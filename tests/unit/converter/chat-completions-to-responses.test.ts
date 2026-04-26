/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import {
  convertChatCompletionToResponses,
  formatOpenAIResponsesSse,
} from "../../../src/converter/chat-completions-to-responses";
import type { OpenAIChatCompletionResponse } from "../../../src/converter/openai-to-anthropic";

describe("convertChatCompletionToResponses", () => {
  it("produces response object and output for text", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    };
    const r = convertChatCompletionToResponses(chat, "gpt-4o");
    expect(r.object).toBe("response");
    expect(r.model).toBe("gpt-4o");
    expect(r.status).toBe("completed");
    expect(r.id.startsWith("resp_")).toBe(true);
    expect(r.usage).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    });
    expect(Array.isArray(r.output)).toBe(true);
  });
});

describe("formatOpenAIResponsesSse", () => {
  it("emits text deltas, output item lifecycle, response.completed, and [DONE] for assistant text", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1700000000,
      model: "m",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    const sse = formatOpenAIResponsesSse(r);
    const dataLines = sse.split("\n\n").filter(b => b.startsWith("data: ") && b !== "data: [DONE]");
    expect(
      dataLines.some(l => l.includes('"type":"response.created"') && l.includes('"in_progress"'))
    ).toBe(true);
    expect(dataLines.some(l => l.includes('"type":"response.output_item.added"'))).toBe(true);
    expect(
      dataLines.some(
        l => l.includes('"type":"response.output_text.delta"') && l.includes('"delta":"Hi"')
      )
    ).toBe(true);
    expect(dataLines.some(l => l.includes('"type":"response.output_text.done"'))).toBe(true);
    expect(dataLines.some(l => l.includes('"type":"response.output_item.done"'))).toBe(true);
    expect(
      dataLines.some(l => l.includes('"type":"response.completed"') && l.includes('"completed"'))
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
      events.some(
        (e: { type?: string }) => e.type === "response.function_call_arguments.delta"
      )
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
    expect(
      (itemDones[1] as { item?: { type?: string; name?: string } }).item?.type
    ).toBe("function_call");
    expect(
      (itemDones[1] as { item?: { name?: string } }).item?.name
    ).toBe("get_weather");
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
      events.some(
        (e: { type?: string }) => e.type === "response.function_call_arguments.done"
      )
    ).toBe(true);
    expect(events.some((e: { type?: string }) => e.type === "response.output_text.delta")).toBe(
      false
    );
    // Minimal path: only response.created and response.completed (2 data lines before [DONE]).
    const dataEventCount = events.length;
    expect(dataEventCount).toBeGreaterThan(2);
  });
});

function parseSseDataEvents(sse: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of sse.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
    }
    const json = line.slice("data: ".length);
    out.push(JSON.parse(json) as Record<string, unknown>);
  }
  return out;
}

describe("message content as array (provider multipart)", () => {
  it("joins text parts into output_text for convertChatCompletionToResponses", () => {
    const chat = {
      id: "chatcmpl-x",
      object: "chat.completion" as const,
      created: 1700000000,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: "Hel" },
              { type: "text" as const, text: "lo" },
            ] as unknown as string,
          },
          finish_reason: "stop" as const,
        },
      ],
    };
    const r = convertChatCompletionToResponses(chat, "m");
    const outMsg = r.output[0] as {
      type: string;
      content?: { type: string; text: string }[];
    };
    expect(outMsg.type).toBe("message");
    const textPart = outMsg.content?.find(c => c.type === "output_text");
    expect(textPart?.text).toBe("Hello");
  });
});
