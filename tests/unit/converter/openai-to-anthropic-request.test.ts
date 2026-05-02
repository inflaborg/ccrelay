/* eslint-disable @typescript-eslint/naming-convention -- OpenAI/Anthropic API bodies use snake_case */
import { describe, it, expect } from "vitest";
import {
  convertOpenAIRequestToAnthropic,
  isOpenAIChatCompletionsRequest,
} from "@/converter/openai-to-anthropic-request";

describe("convertOpenAIRequestToAnthropic", () => {
  it("maps /v1/chat/completions to /v1/messages", () => {
    const { newPath, request } = convertOpenAIRequestToAnthropic(
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
      },
      "/v1/chat/completions"
    );
    expect(newPath).toBe("/v1/messages");
    expect(request.model).toBe("claude-3-5-sonnet-20241022");
    expect(request.max_tokens).toBe(1024);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].role).toBe("user");
    expect(request.messages[0].content).toBe("Hello");
  });

  it("merges system messages into Anthropic system field", () => {
    const { request } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 100,
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hi" },
        ],
      },
      "/v1/chat/completions"
    );
    expect(request.system).toBe("You are helpful.");
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toBe("Hi");
  });

  it("merges string and array system messages into system blocks without dropping strings", () => {
    const { request } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 100,
        messages: [
          { role: "system", content: "Prefix from string." },
          {
            role: "system",
            content: [{ type: "text", text: "From array block." }],
          },
          { role: "user", content: "Hi" },
        ],
      },
      "/v1/chat/completions"
    );
    expect(request.system).toEqual([
      { type: "text", text: "Prefix from string." },
      { type: "text", text: "From array block." },
    ]);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toBe("Hi");
  });

  it("isOpenAIChatCompletionsRequest returns true when messages array present", () => {
    expect(isOpenAIChatCompletionsRequest({ messages: [], model: "x" })).toBe(true);
    expect(isOpenAIChatCompletionsRequest({ model: "x" })).toBe(false);
  });

  const sampleFunctionTool = {
    type: "function" as const,
    function: {
      name: "exec_command",
      description: "x",
      parameters: { type: "object" as const, properties: {} },
    },
  };

  it("maps OpenAI string tool_choice to Anthropic object form when tools are present", () => {
    const { request: r1 } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
        tools: [sampleFunctionTool],
        tool_choice: "auto",
      },
      "/v1/chat/completions"
    );
    expect(r1.tool_choice).toEqual({ type: "auto" });

    const { request: r2 } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
        tools: [sampleFunctionTool],
        tool_choice: "none",
      },
      "/v1/chat/completions"
    );
    expect(r2.tool_choice).toEqual({ type: "none" });

    const { request: r3 } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
        tools: [sampleFunctionTool],
        tool_choice: "required",
      },
      "/v1/chat/completions"
    );
    expect(r3.tool_choice).toEqual({ type: "any" });

    const { request: r4 } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
        tools: [sampleFunctionTool],
        tool_choice: { type: "function", function: { name: "exec_command" } },
      },
      "/v1/chat/completions"
    );
    expect(r4.tool_choice).toEqual({ type: "tool", name: "exec_command" });
  });

  it("omits tool_choice when there are no tools (even if tool_choice was set)", () => {
    const { request } = convertOpenAIRequestToAnthropic(
      {
        model: "m",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
        tool_choice: "auto",
      },
      "/v1/chat/completions"
    );
    expect(request.tool_choice).toBeUndefined();
  });
});
