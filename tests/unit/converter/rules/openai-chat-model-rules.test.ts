import { describe, expect, it } from "vitest";
import {
  openaiChatUsesMaxCompletionTokens,
  assignOpenAiChatMaxOutput,
} from "@/converter/rules/openai-chat-model-rules";
import type { OpenAIMessageRequest } from "@/converter/adapters/anthropic-to-openai-chat-request";

describe("openaiChatUsesMaxCompletionTokens", () => {
  it("is true for gpt-5 family", () => {
    expect(openaiChatUsesMaxCompletionTokens("gpt-5")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("gpt-5.1")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("GPT-5-MINI")).toBe(true);
  });

  it("is true for o-series ids", () => {
    expect(openaiChatUsesMaxCompletionTokens("o1")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("o3-mini")).toBe(true);
    expect(openaiChatUsesMaxCompletionTokens("O4-preview")).toBe(true);
  });

  it("is false for gpt-4 and claude-style ids", () => {
    expect(openaiChatUsesMaxCompletionTokens("gpt-4o")).toBe(false);
    expect(openaiChatUsesMaxCompletionTokens("gpt-4.1")).toBe(false);
    expect(openaiChatUsesMaxCompletionTokens("claude-3-5-sonnet-20241022")).toBe(false);
  });

  it("does not match random o in the middle of id", () => {
    expect(openaiChatUsesMaxCompletionTokens("foo-o3-bar")).toBe(false);
  });
});

describe("assignOpenAiChatMaxOutput", () => {
  it("sets max_completion_tokens and clears max_tokens for gpt-5", () => {
    /* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire fields */
    const req: OpenAIMessageRequest = {
      model: "gpt-5",
      messages: [],
      max_tokens: 99,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    assignOpenAiChatMaxOutput(req, 1234);
    expect(req.max_completion_tokens).toBe(1234);
    expect(req.max_tokens).toBeUndefined();
  });

  it("sets max_tokens and clears max_completion_tokens for gpt-4o", () => {
    /* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire fields */
    const req: OpenAIMessageRequest = {
      model: "gpt-4o",
      messages: [],
      max_completion_tokens: 99,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    assignOpenAiChatMaxOutput(req, 2000);
    expect(req.max_tokens).toBe(2000);
    expect(req.max_completion_tokens).toBeUndefined();
  });
});
