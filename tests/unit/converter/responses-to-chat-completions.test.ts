import { describe, it, expect } from "vitest";
import {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
} from "../../../src/converter/responses-to-chat-completions";

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
  it("maps simple string input to user message", () => {
    const { request, newPath } = convertResponsesRequestToChatCompletions(
      { model: "gpt-4o", input: "Hello" },
      "/v1/responses"
    );
    expect(newPath).toBe("/v1/chat/completions");
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
});
