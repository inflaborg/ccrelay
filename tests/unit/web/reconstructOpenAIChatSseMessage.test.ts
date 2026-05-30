/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Chat Completions wire field names */
import { describe, expect, it } from "vitest";
import {
  isOpenAIChatCompletionSseBody,
  reconstructOpenAIChatFromSseLogBody,
} from "../../../web/src/features/logs/reconstructOpenAIChatSseMessage";

function chunk(delta: Record<string, unknown>, finishReason?: string | null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mimo",
    object: "chat.completion.chunk",
    created: 1780150868,
    model: "mimo-v2.5-pro",
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  })}`;
}

describe("reconstructOpenAIChatFromSseLogBody", () => {
  it("returns not_openai_chat_sse for Anthropic SSE", () => {
    const sse =
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[]}}';
    expect(isOpenAIChatCompletionSseBody(sse)).toBe(false);
    const r = reconstructOpenAIChatFromSseLogBody(sse);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_openai_chat_sse");
    }
  });

  it("MiMo regression: reasoning then tool_calls(fields) with usage", () => {
    const lines = [
      chunk({
        role: "assistant",
        content: "",
        tool_calls: null,
        reasoning_content: null,
      }),
      chunk({ content: null, reasoning_content: "用户询问" }),
      chunk({ content: null, reasoning_content: "的是" }),
      chunk({ content: null, reasoning_content: '"10k' }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_ad44e7079f6946deac787adb",
            type: "function",
            function: { name: "fields", arguments: "" },
          },
        ],
        reasoning_content: null,
      }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: null,
            function: { arguments: "{}", name: null },
            type: "function",
          },
        ],
        reasoning_content: null,
      }),
      chunk({ content: null, tool_calls: null, reasoning_content: null }, "tool_calls"),
      `data: ${JSON.stringify({
        id: "chatcmpl-mimo",
        object: "chat.completion.chunk",
        created: 1780150873,
        model: "mimo-v2.5-pro",
        choices: [],
        usage: {
          prompt_tokens: 3350,
          completion_tokens: 168,
          total_tokens: 3518,
          completion_tokens_details: { reasoning_tokens: 154 },
        },
      })}`,
      "data: [DONE]",
    ];

    const r = reconstructOpenAIChatFromSseLogBody(lines.join("\n\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.message.object).toBe("chat.completion");
    expect(r.message.model).toBe("mimo-v2.5-pro");
    const choices = r.message.choices as Record<string, unknown>[];
    expect(choices).toHaveLength(1);
    expect(choices[0].finish_reason).toBe("tool_calls");
    const msg = choices[0].message as Record<string, unknown>;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBeNull();
    expect(msg.reasoning_content).toBe('用户询问的是"10k');
    const toolCalls = msg.tool_calls as Record<string, unknown>[];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id).toBe("call_ad44e7079f6946deac787adb");
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("fields");
    expect(fn.arguments).toBe("{}");
    const usage = r.message.usage as Record<string, unknown>;
    expect(usage.prompt_tokens).toBe(3350);
    expect(usage.completion_tokens).toBe(168);
  });

  it("merges assistant text and tool_calls after content", () => {
    const sse = [
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Let me search." }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_abc",
            type: "function",
            function: { name: "web_search", arguments: "" },
          },
        ],
      }),
      chunk({
        tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }],
      }),
      chunk({}, "tool_calls"),
    ].join("\n\n");

    const r = reconstructOpenAIChatFromSseLogBody(sse);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const msg = (r.message.choices as Record<string, unknown>[])[0].message as Record<
      string,
      unknown
    >;
    expect(msg.content).toBe("Let me search.");
    const fn = (msg.tool_calls as Record<string, unknown>[])[0].function as Record<string, unknown>;
    expect(fn.name).toBe("web_search");
    expect(fn.arguments).toBe('{"q":"x"}');
  });
});
