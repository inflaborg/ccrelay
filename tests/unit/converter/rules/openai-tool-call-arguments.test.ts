/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire field names */
import { describe, it, expect } from "vitest";
import type { OpenAIMessage } from "@/converter/adapters/anthropic-to-openai-chat-request";
import {
  normalizeOpenAiToolCallArgumentsString,
  sanitizeOpenAiChatToolArgumentsInMessages,
} from "@/converter/rules/openai-tool-call-arguments";

describe("normalizeOpenAiToolCallArgumentsString", () => {
  it("returns {} for empty input", () => {
    expect(normalizeOpenAiToolCallArgumentsString("")).toBe("{}");
    expect(normalizeOpenAiToolCallArgumentsString("   ")).toBe("{}");
  });

  it("passes through valid object JSON", () => {
    expect(normalizeOpenAiToolCallArgumentsString('{"query":"test"}')).toBe('{"query":"test"}');
  });

  it("wraps truncated JSON as raw", () => {
    const truncated = '{"target_file":"/Users/dzhsurf/Documents/code';
    const out = normalizeOpenAiToolCallArgumentsString(truncated);
    expect(JSON.parse(out)).toEqual({ raw: truncated });
  });

  it("wraps non-object JSON values", () => {
    expect(JSON.parse(normalizeOpenAiToolCallArgumentsString('"hello"'))).toEqual({
      value: "hello",
    });
    expect(JSON.parse(normalizeOpenAiToolCallArgumentsString("[1,2]"))).toEqual({
      value: [1, 2],
    });
  });
});

describe("sanitizeOpenAiChatToolArgumentsInMessages", () => {
  it("repairs assistant tool_calls in place", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "Read", arguments: '{"path":"/tmp' },
          },
        ],
      },
    ];
    expect(sanitizeOpenAiChatToolArgumentsInMessages(messages)).toBe(1);
    const args = messages[0].tool_calls?.[0].function.arguments ?? "";
    expect(JSON.parse(args)).toEqual({ raw: '{"path":"/tmp' });
  });
});
