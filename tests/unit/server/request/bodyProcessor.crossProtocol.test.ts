import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

describe("BodyProcessor cross-protocol upstream path", () => {
  const openaiUpstream: Provider = {
    id: "mimo",
    name: "Mimo",
    baseUrl: "https://example.com/v1",
    mode: "passthrough",
    providerType: "openai_chat",
    apiKey: "sk",
  };

  const anthropicUpstream: Provider = {
    id: "official",
    name: "Official",
    baseUrl: "https://api.anthropic.com",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
  };

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "GET",
      path: "/anthropic/v1/models",
      provider: openaiUpstream,
      headers: {},
      targetUrl: "https://example.com/v1/v1/models",
      targetPath: "/v1/models",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: true,
      clientSurface: "anthropic",
      ...overrides,
    };
  }

  it("rewrites anthropic GET /v1/models to OpenAI upstream /models before empty-body return", () => {
    const routing = makeRouting({});
    const proc = new BodyProcessor();
    proc.process(Buffer.alloc(0), routing, false);
    expect(routing.targetPath).toBe("/models");
    expect(routing.targetUrl).toBe("https://example.com/v1/models");
  });

  it("rewrites anthropic GET /v1/models/{id} to OpenAI upstream /models/{id}", () => {
    const routing = makeRouting({
      path: "/anthropic/v1/models/gpt-4",
      targetUrl: "https://example.com/v1/v1/models/gpt-4",
      targetPath: "/v1/models/gpt-4",
    });
    const proc = new BodyProcessor();
    proc.process(Buffer.alloc(0), routing, false);
    expect(routing.targetPath).toBe("/models/gpt-4");
    expect(routing.targetUrl).toBe("https://example.com/v1/models/gpt-4");
  });

  it("rewrites OpenAI GET /models/{id} to anthropic upstream /v1/models/{id}", () => {
    const routing = makeRouting({
      path: "/openai/models/claude-3",
      provider: anthropicUpstream,
      targetPath: "/models/claude-3",
      targetUrl: "https://api.anthropic.com/models/claude-3",
      isOpenAIProvider: false,
      clientSurface: "openai",
    });
    const proc = new BodyProcessor();
    proc.process(Buffer.alloc(0), routing, false);
    expect(routing.targetPath).toBe("/v1/models/claude-3");
    expect(routing.targetUrl).toBe("https://api.anthropic.com/v1/models/claude-3");
  });

  it("rewrites OpenAI GET /models to anthropic upstream /v1/models", () => {
    const routing = makeRouting({
      path: "/openai/models",
      provider: anthropicUpstream,
      targetPath: "/models",
      targetUrl: "https://api.anthropic.com/models",
      isOpenAIProvider: false,
      clientSurface: "openai",
    });
    const proc = new BodyProcessor();
    proc.process(Buffer.alloc(0), routing, false);
    expect(routing.targetPath).toBe("/v1/models");
    expect(routing.targetUrl).toBe("https://api.anthropic.com/v1/models");
  });
});
