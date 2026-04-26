/* eslint-disable @typescript-eslint/naming-convention -- OpenAI/Anthropic API bodies use snake_case */
import { describe, it, expect } from "vitest";
import {
  convertOpenAIRequestToAnthropic,
  isOpenAIChatCompletionsRequest,
} from "../../../src/converter/openai-to-anthropic-request";

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

  it("isOpenAIChatCompletionsRequest returns true when messages array present", () => {
    expect(isOpenAIChatCompletionsRequest({ messages: [], model: "x" })).toBe(true);
    expect(isOpenAIChatCompletionsRequest({ model: "x" })).toBe(false);
  });

  it("maps custom openaiChatCompletionsPath to /v1/messages", () => {
    const { newPath } = convertOpenAIRequestToAnthropic(
      { model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] },
      "/custom/chat/completions",
      { openaiChatCompletionsPath: "/custom/chat/completions" }
    );
    expect(newPath).toBe("/v1/messages");
  });
});
