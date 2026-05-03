import { describe, it, expect } from "vitest";
import { resolveUpstreamPath } from "@/server/request/routerStage";

describe("resolveUpstreamPath", () => {
  it("strips /anthropic and preserves /v1/models for Anthropic wire", () => {
    expect(resolveUpstreamPath("/anthropic/v1/models")).toBe("/v1/models");
  });

  it("strips /anthropic for other Anthropic routes without OpenAI-style rewrites", () => {
    expect(resolveUpstreamPath("/anthropic/v1/messages")).toBe("/v1/messages");
  });

  describe("OpenAI base http://host/openai (recommended)", () => {
    it("maps /openai/chat/completions to /chat/completions", () => {
      expect(resolveUpstreamPath("/openai/chat/completions")).toBe("/chat/completions");
    });
    it("maps /openai/models to /models", () => {
      expect(resolveUpstreamPath("/openai/models")).toBe("/models");
    });
    it("maps /openai/responses to /responses", () => {
      expect(resolveUpstreamPath("/openai/responses")).toBe("/responses");
    });
  });

  describe("Legacy OpenAI base http://host/v1 on ccrelay", () => {
    it("collapses /v1/chat/completions when upstream baseUrl already has /v1", () => {
      expect(resolveUpstreamPath("/v1/chat/completions")).toBe("/chat/completions");
    });
    it("collapses /v1/models", () => {
      expect(resolveUpstreamPath("/v1/models")).toBe("/models");
    });
    it("collapses /v1/responses", () => {
      expect(resolveUpstreamPath("/v1/responses")).toBe("/responses");
    });
  });

  describe("SDK tolerance: /openai/v1/… after stripping /openai", () => {
    it("strips /openai and maps /v1/models to /models", () => {
      expect(resolveUpstreamPath("/openai/v1/models")).toBe("/models");
    });
    it("strips /openai and maps /v1/chat/completions", () => {
      expect(resolveUpstreamPath("/openai/v1/chat/completions")).toBe("/chat/completions");
    });
  });
});
