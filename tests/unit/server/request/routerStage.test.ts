import { describe, it, expect } from "vitest";
import { resolveUpstreamPath } from "@/server/request/routerStage";

describe("resolveUpstreamPath", () => {
  it("strips /anthropic and preserves /v1/models for Anthropic wire", () => {
    expect(resolveUpstreamPath("GET", "/anthropic/v1/models")).toBe("/v1/models");
  });

  it("strips /anthropic for other Anthropic routes", () => {
    expect(resolveUpstreamPath("POST", "/anthropic/v1/messages")).toBe("/v1/messages");
  });

  describe("OpenAI prefix http://host/openai", () => {
    it("maps /openai/chat/completions to /chat/completions", () => {
      expect(resolveUpstreamPath("POST", "/openai/chat/completions")).toBe("/chat/completions");
    });
    it("maps /openai/models to /models", () => {
      expect(resolveUpstreamPath("GET", "/openai/models")).toBe("/models");
    });
    it("maps /openai/responses to /responses", () => {
      expect(resolveUpstreamPath("POST", "/openai/responses")).toBe("/responses");
    });
  });

  describe("Legacy relay root: OpenAI-wire /v1/... to canonical OpenAI paths", () => {
    it("maps GET /v1/models to /models", () => {
      expect(resolveUpstreamPath("GET", "/v1/models")).toBe("/models");
    });
    it("maps POST /v1/chat/completions to /chat/completions", () => {
      expect(resolveUpstreamPath("POST", "/v1/chat/completions")).toBe("/chat/completions");
    });
    it("maps POST /v1/responses to /responses", () => {
      expect(resolveUpstreamPath("POST", "/v1/responses")).toBe("/responses");
    });
  });

  describe("Legacy relay root: Anthropic wire unchanged", () => {
    it("keeps POST /v1/messages", () => {
      expect(resolveUpstreamPath("POST", "/v1/messages")).toBe("/v1/messages");
    });
    it("keeps POST /v1/messages/count_tokens", () => {
      expect(resolveUpstreamPath("POST", "/v1/messages/count_tokens")).toBe(
        "/v1/messages/count_tokens"
      );
    });
  });

  describe("/openai + mistaken /v1 segment (normalize to OpenAI wire if mapping matches)", () => {
    it("GET /openai/v1/models -> /models", () => {
      expect(resolveUpstreamPath("GET", "/openai/v1/models")).toBe("/models");
    });
    it("POST /openai/v1/chat/completions -> /chat/completions", () => {
      expect(resolveUpstreamPath("POST", "/openai/v1/chat/completions")).toBe("/chat/completions");
    });
  });
});
