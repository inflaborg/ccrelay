import { describe, it, expect } from "vitest";
import { detectApiSurface } from "../../../../src/server/request/apiSurfaceDetector";

describe("detectApiSurface", () => {
  it("detects OpenAI chat completions", () => {
    expect(detectApiSurface("POST", "/v1/chat/completions")).toBe("openai");
  });

  it("detects GET models", () => {
    expect(detectApiSurface("GET", "/v1/models")).toBe("openai");
  });

  it("detects Anthropic messages", () => {
    expect(detectApiSurface("POST", "/v1/messages")).toBe("anthropic");
    expect(detectApiSurface("POST", "/messages")).toBe("anthropic");
  });

  it("detects count_tokens", () => {
    expect(detectApiSurface("POST", "/v1/messages/count_tokens")).toBe("anthropic");
  });

  it("returns null for unknown paths", () => {
    expect(detectApiSurface("GET", "/v1/unknown")).toBeNull();
  });
});
