import { describe, expect, it } from "vitest";
import { usesMaxCompletionTokensForOpenAiChatModel } from "@/api/wizardUpstream";

describe("usesMaxCompletionTokensForOpenAiChatModel", () => {
  it("is true for gpt-5 family", () => {
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-5")).toBe(true);
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-5.2")).toBe(true);
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-5-chat-latest")).toBe(true);
  });

  it("is true for o-series reasoning models", () => {
    expect(usesMaxCompletionTokensForOpenAiChatModel("o1")).toBe(true);
    expect(usesMaxCompletionTokensForOpenAiChatModel("o3-mini")).toBe(true);
    expect(usesMaxCompletionTokensForOpenAiChatModel("o4-mini")).toBe(true);
  });

  it("is false for gpt-4 and classic ids", () => {
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-4o")).toBe(false);
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-4-turbo")).toBe(false);
    expect(usesMaxCompletionTokensForOpenAiChatModel("gpt-3.5-turbo")).toBe(false);
  });
});
