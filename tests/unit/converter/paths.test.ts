import { describe, it, expect } from "vitest";
import {
  isOpenAIChatCompletionsWirePath,
  isOpenAIType,
  mapAnthropicWirePathToOpenAiUpstream,
  mapOpenAiWirePathToAnthropicUpstream,
} from "@/converter/paths";

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

describe("crossProtocol upstream path mapping", () => {
  describe("mapAnthropicWirePathToOpenAiUpstream", () => {
    it("maps GET /v1/models to /models", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/models", "GET")).toBe("/models");
    });
    it("maps GET /v1/models/{id} to /models/{id}", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/models/claude-3", "GET")).toBe(
        "/models/claude-3"
      );
    });
    it("maps POST /v1/messages to /chat/completions", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/messages", "POST")).toBe(
        "/chat/completions"
      );
    });
    it("leaves other paths unchanged", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/messages/count_tokens", "POST")).toBe(
        "/v1/messages/count_tokens"
      );
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/models", "POST")).toBe("/v1/models");
    });
  });

  describe("mapOpenAiWirePathToAnthropicUpstream", () => {
    it("maps GET /models to /v1/models", () => {
      expect(mapOpenAiWirePathToAnthropicUpstream("/models", "GET")).toBe("/v1/models");
    });
    it("maps GET /models/{id} to /v1/models/{id}", () => {
      expect(mapOpenAiWirePathToAnthropicUpstream("/models/gpt-4", "GET")).toBe("/v1/models/gpt-4");
    });
    it("maps POST /chat/completions and /v1/chat/completions to /v1/messages", () => {
      expect(mapOpenAiWirePathToAnthropicUpstream("/chat/completions", "POST")).toBe(
        "/v1/messages"
      );
      expect(mapOpenAiWirePathToAnthropicUpstream("/v1/chat/completions", "POST")).toBe(
        "/v1/messages"
      );
    });
    it("leaves Responses path unchanged", () => {
      expect(mapOpenAiWirePathToAnthropicUpstream("/v1/responses", "POST")).toBe("/v1/responses");
    });
  });
});
