import { describe, it, expect } from "vitest";
import {
  isOpenAIChatCompletionsWirePath,
  isOpenAIType,
} from "../../../src/converter/openaiPath";

describe("isOpenAIChatCompletionsWirePath", () => {
  it("accepts /v1/chat/completions", () => {
    expect(isOpenAIChatCompletionsWirePath("/v1/chat/completions")).toBe(true);
  });

  it("accepts /chat/completions", () => {
    expect(isOpenAIChatCompletionsWirePath("/chat/completions")).toBe(true);
  });

  it("rejects other paths", () => {
    expect(isOpenAIChatCompletionsWirePath("/v1/messages")).toBe(false);
    expect(isOpenAIChatCompletionsWirePath("/v1/responses")).toBe(false);
    expect(isOpenAIChatCompletionsWirePath("/paas/v4/chat/completions")).toBe(false);
  });
});

describe("isOpenAIType", () => {
  it("returns true for 'openai'", () => {
    expect(isOpenAIType("openai")).toBe(true);
  });

  it("returns true for 'openai_chat'", () => {
    expect(isOpenAIType("openai_chat")).toBe(true);
  });

  it("returns false for 'anthropic'", () => {
    expect(isOpenAIType("anthropic")).toBe(false);
  });
});
