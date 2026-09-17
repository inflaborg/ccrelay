import { describe, it, expect } from "vitest";
import {
  convertOpenAIMessageRequestToResponsesRequest,
  maybeUpgradeChatFunctionToolsToResponses,
} from "@/converter/adapters/openai-chat-to-responses-request";
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

  it("maps assistant history to output_text (Responses rejects input_text on assistant)", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-6-astra",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello." },
        { role: "user", content: "Again" },
      ],
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.request.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello." }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Again" }],
      },
    ]);
  });

  it("maps gpt-6 none reasoning_effort to Responses low", () => {
    const chat: OpenAIMessageRequest = {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "Hi" }],
      reasoning_effort: "none",
    };
    const r = convertOpenAIMessageRequestToResponsesRequest(chat);
    expect(r.request.reasoning).toEqual({ effort: "low" });
  });
});

describe("maybeUpgradeChatFunctionToolsToResponses", () => {
  it("upgrades gpt-6 Chat function tools to /responses", () => {
    const out = maybeUpgradeChatFunctionToolsToResponses({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "?" }],
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: { name: "exec_command", parameters: { type: "object", properties: {} } },
        },
      ],
    });
    expect(out).not.toBeNull();
    expect(out?.path).toBe("/responses");
    expect(out?.responseFormat).toBe("responses");
    expect(out?.body.reasoning).toEqual({ effort: "high" });
  });

  it("upgrades gpt-5.4 Chat function tools to /responses", () => {
    const out = maybeUpgradeChatFunctionToolsToResponses({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "?" }],
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: { name: "exec_command", parameters: { type: "object", properties: {} } },
        },
      ],
    });
    expect(out).not.toBeNull();
    expect(out?.path).toBe("/responses");
    expect(out?.body.reasoning).toEqual({ effort: "high" });
  });

  it("does not upgrade gpt-6 without function tools", () => {
    expect(
      maybeUpgradeChatFunctionToolsToResponses({
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "hi" }],
      })
    ).toBeNull();
  });
});
