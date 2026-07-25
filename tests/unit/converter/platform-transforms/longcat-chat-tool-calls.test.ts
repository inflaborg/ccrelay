/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Chat Completions wire names */
import { describe, it, expect } from "vitest";
import {
  extractLongcatToolCalls,
  parseLongcatArgValue,
  sanitizeLongcatChatCompletion,
  applyPlatformChatResponseSanitize,
  platformBuffersChatContentForToolParse,
} from "@/converter/platform-transforms";
import {
  convertChatCompletionToResponses,
  createStreamingState,
  processStreamingChunk,
} from "@/converter";
import type { OpenAIChatCompletionResponse } from "@/converter/adapters/openai-chat-to-anthropic-response";

const LONGCAT_BASE = "https://api.longcat.chat/openai/v1";

describe("parseLongcatArgValue", () => {
  it("parses JSON numbers, booleans, arrays, objects", () => {
    expect(parseLongcatArgValue("10000")).toBe(10000);
    expect(parseLongcatArgValue("true")).toBe(true);
    expect(parseLongcatArgValue('["a","b"]')).toEqual(["a", "b"]);
    expect(parseLongcatArgValue('{"x":1}')).toEqual({ x: 1 });
  });

  it("keeps plain strings", () => {
    expect(parseLongcatArgValue("ls -la ~/Documents")).toBe("ls -la ~/Documents");
  });
});

describe("extractLongcatToolCalls", () => {
  it("extracts function name and arg key/value pairs", () => {
    const text = `<longcat_tool_call>exec
<longcat_arg_key>command</longcat_arg_key>
<longcat_arg_value>ls -la ~/Documents | grep -P '[\\x{4e00}-\\x{9fff}]'</longcat_arg_value>
<longcat_arg_key>timeout</longcat_arg_key>
<longcat_arg_value>10000</longcat_arg_value>
</longcat_tool_call>
`;
    const { content, toolCalls } = extractLongcatToolCalls(text);
    expect(content).toBe("");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe("function");
    expect(toolCalls[0].function.name).toBe("exec");
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      command: "ls -la ~/Documents | grep -P '[\\x{4e00}-\\x{9fff}]'",
      timeout: 10000,
    });
  });

  it("preserves preamble text before tool calls", () => {
    const text = `Looking that up now.
<longcat_tool_call>wait
<longcat_arg_key>cell_id</longcat_arg_key>
<longcat_arg_value>abc</longcat_arg_value>
</longcat_tool_call>`;
    const { content, toolCalls } = extractLongcatToolCalls(text);
    expect(content).toBe("Looking that up now.");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe("wait");
  });

  it("supports multiple tool call blocks", () => {
    const text = `<longcat_tool_call>a
<longcat_arg_key>x</longcat_arg_key>
<longcat_arg_value>1</longcat_arg_value>
</longcat_tool_call>
<longcat_tool_call>b
<longcat_arg_key>y</longcat_arg_key>
<longcat_arg_value>2</longcat_arg_value>
</longcat_tool_call>`;
    const { toolCalls } = extractLongcatToolCalls(text);
    expect(toolCalls.map(t => t.function.name)).toEqual(["a", "b"]);
  });

  it("returns original text when no tags", () => {
    expect(extractLongcatToolCalls("hello")).toEqual({ content: "hello", toolCalls: [] });
  });
});

describe("sanitizeLongcatChatCompletion", () => {
  it("lifts XML into tool_calls and sets finish_reason", () => {
    const body: Record<string, unknown> = {
      id: "chatcmpl_1",
      object: "chat.completion",
      created: 1,
      model: "LongCat-2.0",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `<longcat_tool_call>exec
<longcat_arg_key>command</longcat_arg_key>
<longcat_arg_value>echo hi</longcat_arg_value>
</longcat_tool_call>`,
          },
        },
      ],
    };
    sanitizeLongcatChatCompletion(body);
    const choice = (body.choices as Record<string, unknown>[])[0];
    const message = choice.message as Record<string, unknown>;
    expect(message.content).toBeNull();
    expect(choice.finish_reason).toBe("tool_calls");
    const toolCalls = message.tool_calls as {
      function: { name: string; arguments: string };
    }[];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe("exec");
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ command: "echo hi" });
  });
});

describe("applyPlatformChatResponseSanitize", () => {
  it("applies for LongCat baseUrl", () => {
    const body: Record<string, unknown> = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `<longcat_tool_call>spawn_agent
<longcat_arg_key>task_name</longcat_arg_key>
<longcat_arg_value>t1</longcat_arg_value>
<longcat_arg_key>message</longcat_arg_key>
<longcat_arg_value>go</longcat_arg_value>
</longcat_tool_call>`,
          },
        },
      ],
    };
    applyPlatformChatResponseSanitize(body, LONGCAT_BASE);
    const msg = (body.choices as Record<string, unknown>[])[0].message as Record<string, unknown>;
    expect((msg.tool_calls as unknown[]).length).toBe(1);
  });

  it("no-ops for unknown hosts", () => {
    const body: Record<string, unknown> = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `<longcat_tool_call>exec
<longcat_arg_key>command</longcat_arg_key>
<longcat_arg_value>x</longcat_arg_value>
</longcat_tool_call>`,
          },
        },
      ],
    };
    applyPlatformChatResponseSanitize(body, "https://api.openai.com/v1");
    const msg = (body.choices as Record<string, unknown>[])[0].message as Record<string, unknown>;
    expect(msg.tool_calls).toBeUndefined();
    expect(typeof msg.content).toBe("string");
  });

  it("platformBuffersChatContentForToolParse matches LongCat only", () => {
    expect(platformBuffersChatContentForToolParse(LONGCAT_BASE)).toBe(true);
    expect(platformBuffersChatContentForToolParse("https://api.openai.com/v1")).toBe(false);
  });
});

describe("LongCat Chat → Responses conversion", () => {
  it("produces function_call output items instead of XML output_text", () => {
    const chat: OpenAIChatCompletionResponse = {
      id: "chatcmpl_x",
      object: "chat.completion",
      created: 1,
      model: "LongCat-2.0",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `<longcat_tool_call>exec
<longcat_arg_key>command</longcat_arg_key>
<longcat_arg_value>ls</longcat_arg_value>
<longcat_arg_key>timeout</longcat_arg_key>
<longcat_arg_value>10000</longcat_arg_value>
</longcat_tool_call>`,
          },
        },
      ],
    };
    applyPlatformChatResponseSanitize(chat as unknown as Record<string, unknown>, LONGCAT_BASE);
    const out = convertChatCompletionToResponses(chat, "LongCat-2.0");
    const fcs = out.output.filter(
      (o): o is Record<string, unknown> =>
        !!o && typeof o === "object" && (o as { type?: string }).type === "function_call"
    );
    expect(fcs).toHaveLength(1);
    expect(fcs[0].name).toBe("exec");
    expect(JSON.parse(String(fcs[0].arguments))).toEqual({ command: "ls", timeout: 10000 });
    const msgs = out.output.filter(
      (o): o is Record<string, unknown> =>
        !!o && typeof o === "object" && (o as { type?: string }).type === "message"
    );
    expect(msgs).toHaveLength(0);
  });
});

describe("LongCat streaming Chat → Responses", () => {
  it("buffers content and emits function_call at finish", () => {
    const state = createStreamingState({ bufferContentForToolParse: true });
    const xml = `<longcat_tool_call>exec
<longcat_arg_key>command</longcat_arg_key>
<longcat_arg_value>pwd</longcat_arg_value>
</longcat_tool_call>`;

    let events = processStreamingChunk(
      state,
      JSON.stringify({
        id: "1",
        object: "chat.completion.chunk",
        created: 1,
        model: "LongCat-2.0",
        choices: [{ index: 0, delta: { role: "assistant", content: xml }, finish_reason: null }],
      })
    );
    // Buffered: should not stream raw XML as output_text.delta
    expect(events.join("")).not.toContain("response.output_text.delta");
    expect(events.join("")).not.toContain("longcat_tool_call");

    events = processStreamingChunk(
      state,
      JSON.stringify({
        id: "1",
        object: "chat.completion.chunk",
        created: 1,
        model: "LongCat-2.0",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })
    );
    expect(events.join("")).toContain("function_call");
    expect(events.join("")).toContain('"name":"exec"');

    const done = processStreamingChunk(state, "[DONE]");
    const all = done.join("");
    expect(all).toContain("response.function_call_arguments.done");
    expect(all).toContain("response.completed");
    expect(all).not.toContain("longcat_tool_call");
  });
});
