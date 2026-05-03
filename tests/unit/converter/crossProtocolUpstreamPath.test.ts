import { describe, it, expect } from "vitest";
import {
  mapAnthropicWirePathToOpenAiUpstream,
  mapOpenAiWirePathToAnthropicUpstream,
} from "@/converter/crossProtocolUpstreamPath";

describe("crossProtocolUpstreamPath", () => {
  describe("mapAnthropicWirePathToOpenAiUpstream", () => {
    it("maps GET /v1/models to /models", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/models", "GET")).toBe("/models");
    });
    it("maps POST /v1/messages to /chat/completions", () => {
      expect(mapAnthropicWirePathToOpenAiUpstream("/v1/messages", "POST")).toBe("/chat/completions");
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
