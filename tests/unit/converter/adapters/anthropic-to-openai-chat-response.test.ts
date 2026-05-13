/* eslint-disable @typescript-eslint/naming-convention -- API fixtures use snake_case */
import { describe, it, expect } from "vitest";
import {
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "@/converter/adapters/anthropic-to-openai-chat-response";
import type { AnthropicMessageResponse } from "@/converter/adapters/openai-chat-to-anthropic-response";

describe("convertAnthropicResponseToOpenAI", () => {
  const base: AnthropicMessageResponse = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-3",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
    },
  };

  it("maps to OpenAI chat.completion shape", () => {
    const o = convertAnthropicResponseToOpenAI(base, "claude-3");
    expect(o.object).toBe("chat.completion");
    expect(o.model).toBe("claude-3");
    expect(o.choices).toHaveLength(1);
    expect(o.choices[0].message.content).toBe("Hello");
    expect(o.choices[0].finish_reason).toBe("stop");
    expect(o.usage?.prompt_tokens).toBe(10);
    expect(o.usage?.completion_tokens).toBe(5);
  });

  it("maps thinking block to message.reasoning_content for DeepSeek-style clients", () => {
    const anthropic: AnthropicMessageResponse = {
      ...base,
      content: [
        { type: "thinking", thinking: "Internal chain", signature: "sig1" },
        { type: "text", text: "Hello" },
      ],
    };
    const o = convertAnthropicResponseToOpenAI(anthropic, "claude-3");
    expect(o.choices[0].message.thinking).toEqual({
      content: "Internal chain",
      signature: "sig1",
    });
    expect(o.choices[0].message.reasoning_content).toBe("Internal chain");
    expect(o.choices[0].message.content).toBe("Hello");
  });

  it("isAnthropicMessageResponse recognizes message type", () => {
    expect(isAnthropicMessageResponse(base)).toBe(true);
    expect(isAnthropicMessageResponse({ type: "error" })).toBe(false);
  });

  it("maps stop_reason stop_sequence to OpenAI finish_reason stop", () => {
    const o = convertAnthropicResponseToOpenAI(
      { ...base, stop_reason: "stop_sequence" },
      "claude-3"
    );
    expect(o.choices[0].finish_reason).toBe("stop");
  });

  describe("server-side tools (opaque text, not OpenAI tool_calls)", () => {
    it("serializes server_tool_use and *_tool_result as assistant text JSON, no tool_calls", () => {
      const anthropic = {
        ...base,
        content: [
          { type: "text", text: "Searching." },
          {
            type: "server_tool_use",
            id: "srv_1",
            name: "web_search",
            input: { query: "pandas" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srv_1",
            content: [],
          },
        ],
      } satisfies AnthropicMessageResponse;

      const o = convertAnthropicResponseToOpenAI(anthropic, "claude-3");
      expect(o.choices[0].message.tool_calls).toBeUndefined();
      const content = o.choices[0].message.content ?? "";
      expect(content).toContain("Searching.");
      expect(content).toContain(
        JSON.stringify({
          type: "server_tool_use",
          id: "srv_1",
          name: "web_search",
          input: { query: "pandas" },
        })
      );
      const linesOut = content.split("\n");
      expect(linesOut[linesOut.length - 1]).toBe("[]");
    });

    it("maps stop_reason tool_use to finish_reason stop when only server_tool_use blocks", () => {
      const anthropic = {
        ...base,
        stop_reason: "tool_use",
        content: [
          {
            type: "server_tool_use",
            id: "srv_1",
            name: "web_search",
            input: {},
          },
        ],
      } satisfies AnthropicMessageResponse;

      const o = convertAnthropicResponseToOpenAI(anthropic, "claude-3");
      expect(o.choices[0].finish_reason).toBe("stop");
      expect(o.choices[0].message.tool_calls).toBeUndefined();
    });

    it("keeps stop_reason tool_use -> finish_reason tool_calls when client tool_use exists", () => {
      const anthropic = {
        ...base,
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "browser_search",
            input: { q: "x" },
          },
        ],
      } satisfies AnthropicMessageResponse;

      const o = convertAnthropicResponseToOpenAI(anthropic, "claude-3");
      expect(o.choices[0].finish_reason).toBe("tool_calls");
      expect(o.choices[0].message.tool_calls).toHaveLength(1);
    });
  });
});
