import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic / OpenAI wire field names in fixtures */

describe("BodyProcessor Azure Responses web_search (Anthropic inbound)", () => {
  const azureOpenAi: Provider = {
    id: "azure-gpt",
    name: "Azure",
    baseUrl: "https://example.cognitiveservices.azure.com/openai/v1",
    mode: "inject",
    providerType: "openai",
    apiKey: "k",
  };

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider: azureOpenAi,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://example.cognitiveservices.azure.com/openai/v1/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "",
      isRouted: true,
      isOpenAIProvider: true,
      clientSurface: "anthropic",
      ...overrides,
    };
  }

  it("routes hosted web_search to POST /responses and sets upstreamResponseFormat", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Search the web for today's date." }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
      "utf-8"
    );
    const routing = makeRouting({});
    const proc = new BodyProcessor();
    const out = proc.process(body, routing, false);

    expect(out.upstreamResponseFormat).toBe("responses");
    expect(routing.targetPath).toBe("/responses");

    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.stream).toBe(false);
    expect(parsed.input).toBeDefined();
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(
      (parsed.tools as unknown[]).some(t => (t as { type?: string }).type === "web_search")
    ).toBe(true);
  });

  it("does not set upstreamResponseFormat when no hosted web_search tool", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hi" }],
      }),
      "utf-8"
    );
    const routing = makeRouting({});
    const out = new BodyProcessor().process(body, routing, false);
    expect(out.upstreamResponseFormat).toBeUndefined();
    expect(routing.targetPath).toContain("chat");
  });

  it("does not set upstreamResponseFormat for non-Azure host even with web_search", () => {
    const plainOpenAi: Provider = {
      ...azureOpenAi,
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
    };
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hi" }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
      "utf-8"
    );
    const routing = makeRouting({ provider: plainOpenAi });
    const out = new BodyProcessor().process(body, routing, false);
    expect(out.upstreamResponseFormat).toBeUndefined();
  });
});
