/* eslint-disable @typescript-eslint/naming-convention -- API fixtures use snake_case */
import { describe, it, expect } from "vitest";
import {
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "../../../src/converter/anthropic-to-openai-response";
import type { AnthropicMessageResponse } from "../../../src/converter/openai-to-anthropic";

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
});
