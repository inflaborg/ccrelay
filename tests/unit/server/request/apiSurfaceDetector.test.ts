import { describe, it, expect } from "vitest";
import { detectApiSurface, resolveInboundClientSurface } from "@/server/request/apiSurfaceDetector";
import type { Provider } from "@/types";

function p(partial: Partial<Provider> & Pick<Provider, "id" | "providerType">): Provider {
  return {
    name: "x",
    baseUrl: "https://x",
    mode: "passthrough",
    headers: {},
    ...partial,
  };
}

describe("detectApiSurface", () => {
  it("detects OpenAI chat completions", () => {
    expect(detectApiSurface("POST", "/v1/chat/completions")).toBe("openai");
  });

  it("detects GET models", () => {
    expect(detectApiSurface("GET", "/v1/models")).toBe("openai");
  });

  it("detects OpenAI-prefixed endpoints", () => {
    expect(detectApiSurface("POST", "/openai/chat/completions")).toBe("openai");
    expect(detectApiSurface("GET", "/openai/models")).toBe("openai");
    expect(detectApiSurface("POST", "/openai/responses")).toBe("openai_responses");
  });

  it("detects Anthropic-prefixed endpoints", () => {
    expect(detectApiSurface("POST", "/anthropic/v1/messages")).toBe("anthropic");
    expect(detectApiSurface("GET", "/anthropic/v1/models")).toBe("anthropic");
    expect(detectApiSurface("POST", "/anthropic/v1/messages/count_tokens")).toBe("anthropic");
  });

  it("detects Anthropic messages", () => {
    expect(detectApiSurface("POST", "/v1/messages")).toBe("anthropic");
    expect(detectApiSurface("POST", "/messages")).toBeNull();
  });

  it("detects count_tokens", () => {
    expect(detectApiSurface("POST", "/v1/messages/count_tokens")).toBe("anthropic");
  });

  it("detects OpenAI Responses create", () => {
    expect(detectApiSurface("POST", "/v1/responses")).toBe("openai_responses");
  });

  it("returns null for unknown paths", () => {
    expect(detectApiSurface("GET", "/v1/unknown")).toBeNull();
  });
});

describe("resolveInboundClientSurface", () => {
  it("GET /v1/models is always openai (legacy)", () => {
    expect(
      resolveInboundClientSurface("GET", "/v1/models", p({ id: "a", providerType: "openai" }))
    ).toBe("openai");
    expect(
      resolveInboundClientSurface("GET", "/v1/models", p({ id: "b", providerType: "anthropic" }))
    ).toBe("openai");
  });

  it("GET /anthropic/v1/models uses anthropic surface", () => {
    expect(
      resolveInboundClientSurface(
        "GET",
        "/anthropic/v1/models",
        p({ id: "a", providerType: "openai" })
      )
    ).toBe("anthropic");
  });

  it("other paths match detectApiSurface", () => {
    expect(
      resolveInboundClientSurface(
        "POST",
        "/v1/chat/completions",
        p({ id: "a", providerType: "anthropic" })
      )
    ).toBe("openai");
  });
});
