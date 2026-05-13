import { describe, it, expect } from "vitest";
import { convertOpenAIMessageRequestToResponsesRequest } from "@/converter/adapters/openai-chat-to-responses-request";
import type { OpenAIMessageRequest } from "@/converter/adapters/anthropic-to-openai-chat-request";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI / Anthropic wire field names in fixtures */

describe("convertOpenAIMessageRequestToResponsesRequest", () => {
  it("maps Chat Completions with web_search to Responses shape and /responses path", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "What day is it?" }],
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      stream: true,
      max_completion_tokens: 500,
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.newPath).toBe("/responses");
    expect(r.request.model).toBe("gpt-5.4");
    expect(r.request.stream).toBe(false);
    expect(r.request.tools).toEqual([{ type: "web_search" }]);
    expect(r.request.tool_choice).toBe("auto");
    expect(r.request.max_output_tokens).toBe(500);
    expect(Array.isArray(r.request.input)).toBe(true);
    expect(r.request.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "What day is it?" }],
      },
    ]);
  });

  it("passes through extra web_search fields from Chat (platform layer may strip for a given upstream)", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "web_search",
          max_uses: 8,
        },
        {
          type: "web_search",
          user_location: {
            type: "approximate",
            country: "IN",
          },
        },
      ],
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.request.tools).toEqual([
      { type: "web_search", max_uses: 8 },
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: "IN",
        },
      },
    ]);
  });

  it("collects system messages into instructions", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      tools: [{ type: "web_search" }],
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.request.instructions).toBe("You are helpful.");
  });

  it("maps reasoning_effort to Responses reasoning.effort", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-5",
      messages: [{ role: "user", content: "Hi" }],
      reasoning_effort: "medium",
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.request.reasoning).toEqual({ effort: "medium" });
  });
});
