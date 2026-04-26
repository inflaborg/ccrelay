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
});

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
