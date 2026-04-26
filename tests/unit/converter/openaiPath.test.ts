import { describe, it, expect } from "vitest";
import {
  getOpenAIChatCompletionsPath,
  isOpenAIChatCompletionsWirePath,
  DEFAULT_OPENAI_CHAT_COMPLETIONS_PATH,
} from "../../../src/converter/openaiPath";

describe("getOpenAIChatCompletionsPath", () => {
  it("returns default when provider omits the field", () => {
    expect(getOpenAIChatCompletionsPath({})).toBe(DEFAULT_OPENAI_CHAT_COMPLETIONS_PATH);
    expect(getOpenAIChatCompletionsPath(undefined)).toBe(DEFAULT_OPENAI_CHAT_COMPLETIONS_PATH);
  });

  it("uses provider.openaiChatCompletionsPath when set", () => {
    expect(
      getOpenAIChatCompletionsPath({ openaiChatCompletionsPath: "/v1/chat/completions" })
    ).toBe("/v1/chat/completions");
  });
});

describe("isOpenAIChatCompletionsWirePath", () => {
  it("accepts legacy literal paths", () => {
    expect(isOpenAIChatCompletionsWirePath("/v1/chat/completions")).toBe(true);
    expect(isOpenAIChatCompletionsWirePath("/chat/completions")).toBe(true);
  });

  it("accepts custom path when it matches getOpenAIChatCompletionsPath(provider)", () => {
    const provider = { openaiChatCompletionsPath: "/paas/v4/chat/completions" };
    expect(isOpenAIChatCompletionsWirePath("/paas/v4/chat/completions", provider)).toBe(true);
    expect(isOpenAIChatCompletionsWirePath("/v1/chat/completions", provider)).toBe(true);
  });
});
