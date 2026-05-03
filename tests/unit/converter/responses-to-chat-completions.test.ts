import { describe, it, expect } from "vitest";
import {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
} from "@/converter/responses-to-chat-completions";

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
        // eslint-disable-next-line @typescript-eslint/naming-convention -- wire body
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
        // eslint-disable-next-line @typescript-eslint/naming-convention -- wire body
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
      // eslint-disable-next-line @typescript-eslint/naming-convention -- wire body
      { model: "m", input: "x", tool_choice: "required" },
      "/v1/responses"
    );
    expect(request.tool_choice).toBe("required");
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
});
