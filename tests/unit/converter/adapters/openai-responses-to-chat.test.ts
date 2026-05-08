/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
  extractResponsesEcho,
  extractFunctionToolsForEcho,
} from "@/converter/adapters/openai-responses-to-chat";

describe("isOpenAIResponsesRequest", () => {
  it("is true for input string", () => {
    expect(isOpenAIResponsesRequest({ model: "gpt-4o", input: "hi" })).toBe(true);
  });

  it("is true for input array", () => {
    expect(
      isOpenAIResponsesRequest({
        model: "gpt-4o",
        input: [{ type: "message", role: "user", content: "x" }],
      })
    ).toBe(true);
  });

  it("is false for chat completions messages", () => {
    expect(
      isOpenAIResponsesRequest({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      })
    ).toBe(false);
  });
});

describe("convertResponsesRequestToChatCompletions", () => {
  it("maps max_output_tokens to max_completion_tokens for gpt-5", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "gpt-5",
        input: "hi",
        max_output_tokens: 500,
      },
      "/v1/responses"
    );
    expect(request.max_completion_tokens).toBe(500);
    expect(request.max_tokens).toBeUndefined();
  });

  it("maps max_output_tokens to max_tokens for gpt-4o", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "gpt-4o",
        input: "hi",
        max_output_tokens: 300,
      },
      "/v1/responses"
    );
    expect(request.max_tokens).toBe(300);
    expect(request.max_completion_tokens).toBeUndefined();
  });

  it("maps simple string input to user message", () => {
    const { request, newPath } = convertResponsesRequestToChatCompletions(
      { model: "gpt-4o", input: "Hello" },
      "/v1/responses"
    );
    expect(newPath).toBe("/chat/completions");
    expect(request.model).toBe("gpt-4o");
    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("adds system from instructions", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      { model: "m", input: "q", instructions: "You are helpful." },
      "/v1/responses"
    );
    expect(request.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(request.messages[1]).toEqual({ role: "user", content: "q" });
  });

  it("maps tool_choice 'required' to OpenAI 'required' for downstream O-to-A", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      // OpenAI Responses API uses snake_case fields
      { model: "m", input: "x", tool_choice: "required" },
      "/v1/responses"
    );
    expect(request.tool_choice).toBe("required");
  });

  it("merges consecutive parallel function_call input items into one assistant message", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "gpt-4o",
        input: [
          { type: "function_call", name: "list_a", arguments: "{}", call_id: "call_a" },
          { type: "function_call", name: "list_b", arguments: "{}", call_id: "call_b" },
          { type: "function_call_output", call_id: "call_a", output: "[]" },
          { type: "function_call_output", call_id: "call_b", output: "[]" },
        ],
      },
      "/v1/responses"
    );
    const assistants = request.messages.filter(m => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].tool_calls).toHaveLength(2);
    expect(assistants[0].tool_calls?.[0].function.name).toBe("list_a");
    expect(assistants[0].tool_calls?.[1].function.name).toBe("list_b");
    const tools = request.messages.filter(m => m.role === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0].tool_call_id).toBe("call_a");
    expect(tools[1].tool_call_id).toBe("call_b");
  });

  it("does not merge function_call after a tool message (new assistant turn)", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "gpt-4o",
        input: [
          { type: "function_call", name: "first", arguments: "{}", call_id: "c1" },
          { type: "function_call_output", call_id: "c1", output: "done" },
          { type: "function_call", name: "second", arguments: "{}", call_id: "c2" },
        ],
      },
      "/v1/responses"
    );
    const assistants = request.messages.filter(m => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].tool_calls).toHaveLength(1);
    expect(assistants[1].tool_calls).toHaveLength(1);
  });

  it("expands namespace tools with nested function tools", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "m",
        input: "x",
        tools: [
          {
            type: "namespace",
            name: "ns",
            tools: [
              {
                type: "function",
                name: "inner_tool",
                description: "d",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ],
      },
      "/v1/responses"
    );
    expect(request.tools).toEqual([
      {
        type: "function",
        function: {
          name: "inner_tool",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("copies Responses hosted tools into Chat tools (passthrough: no nested web_search envelope)", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "m",
        input: "x",
        tools: [{ type: "web_search", search_context_size: "medium" }],
      },
      "/v1/responses"
    );
    expect(request.tools).toEqual([{ type: "web_search", search_context_size: "medium" }]);
  });

  it("GLM upstream inserts web_search envelope from provider baseUrl", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "m",
        input: "x",
        tools: [{ type: "web_search", search_context_size: "medium" }],
      },
      "/v1/responses",
      { providerBaseUrl: "https://api.z.ai/v1" }
    );
    expect(request.tools).toEqual([
      {
        type: "web_search",
        search_context_size: "medium",
        web_search: { enable: true, search_engine: "search-prime", search_result: true },
      },
    ]);
  });

  it("copies nested hosted tools from namespace bundles", () => {
    const { request } = convertResponsesRequestToChatCompletions(
      {
        model: "m",
        input: "x",
        tools: [
          {
            type: "namespace",
            name: "ns",
            tools: [
              {
                type: "function",
                name: "fn",
                description: "d",
                parameters: { type: "object", properties: {} },
              },
              { type: "mcp", connector_id: "c" },
            ],
          },
        ],
      },
      "/v1/responses"
    );
    expect(request.tools).toHaveLength(2);
    expect(request.tools?.[0]).toMatchObject({ type: "function", function: { name: "fn" } });
    expect(request.tools?.[1]).toEqual({ type: "mcp", connector_id: "c" });
  });
});

describe("extractFunctionToolsForEcho", () => {
  it("keeps top-level type=function tools and hosted tools", () => {
    const raw = [
      { type: "function", name: "my_tool", parameters: {} },
      { type: "web_search" },
      { type: "mcp", connector_id: "x" },
    ];
    const got = extractFunctionToolsForEcho(raw);
    expect(got).toHaveLength(3);
    expect((got[0] as { name?: string }).name).toBe("my_tool");
    expect((got[1] as { type?: string }).type).toBe("web_search");
    expect((got[2] as { type?: string }).type).toBe("mcp");
  });

  it("expands namespace bundle inner tools (function + hosted)", () => {
    const raw = [
      {
        type: "namespace",
        tools: [
          { type: "function", name: "inner_fn", parameters: { type: "object" } },
          { type: "web_search" },
        ],
      },
    ];
    const got = extractFunctionToolsForEcho(raw);
    expect(got).toHaveLength(2);
    expect((got[0] as { name?: string }).name).toBe("inner_fn");
    expect((got[1] as { type?: string }).type).toBe("web_search");
  });
});

describe("extractResponsesEcho", () => {
  it("echoes reasoning, parallel_tool_calls, metadata, instructions", () => {
    const echo = extractResponsesEcho({
      model: "gpt-5",
      tools: [{ type: "function", name: "x", parameters: {} }],
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      instructions: "be brief",
      metadata: { foo: "bar" },
      truncation: "auto",
      store: false,
      tool_choice: { type: "auto" },
    });
    expect(echo.tools).toHaveLength(1);
    expect(echo.parallel_tool_calls).toBe(false);
    expect(echo.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(echo.instructions).toBe("be brief");
    expect(echo.metadata).toEqual({ foo: "bar" });
    expect(echo.truncation).toBe("auto");
    expect(echo.store).toBe(false);
    expect(echo.tool_choice).toEqual({ type: "auto" });
  });
});
