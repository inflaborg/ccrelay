import { describe, it, expect } from "vitest";
import {
  detectApiSurface,
  resolveInboundClientSurface,
} from "@/server/request/apiSurfaceDetector";
import type { Provider } from "@/types";

function p(partial: Partial<Provider> & Pick<Provider, "id" | "providerType">): Provider {
  return {
    name: "x",
    baseUrl: "https://x",
    mode: "passthrough",
    headers: {},
    modelsListFormat: "auto",
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

  it("detects Anthropic messages", () => {
    expect(detectApiSurface("POST", "/v1/messages")).toBe("anthropic");
    expect(detectApiSurface("POST", "/messages")).toBe("anthropic");
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
  it("GET /v1/models: auto uses providerType", () => {
    expect(resolveInboundClientSurface("GET", "/v1/models", p({ id: "a", providerType: "openai" }))).toBe(
      "openai"
    );
    expect(
      resolveInboundClientSurface("GET", "/v1/models", p({ id: "b", providerType: "anthropic" }))
    ).toBe("anthropic");
  });

  it("GET /v1/models: explicit openai/anthropic overrides", () => {
    expect(
      resolveInboundClientSurface(
        "GET",
        "/v1/models?x=1",
        p({ id: "a", providerType: "anthropic", modelsListFormat: "openai" })
      )
    ).toBe("openai");
    expect(
      resolveInboundClientSurface("GET", "/v1/models", p({ id: "b", providerType: "openai", modelsListFormat: "anthropic" }))
    ).toBe("anthropic");
  });

  it("other paths match detectApiSurface", () => {
    expect(
      resolveInboundClientSurface("POST", "/v1/chat/completions", p({ id: "a", providerType: "anthropic" }))
    ).toBe("openai");
  });
});
