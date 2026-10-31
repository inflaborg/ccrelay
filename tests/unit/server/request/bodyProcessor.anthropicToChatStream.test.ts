import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire field names in fixtures */

function provider(
  baseUrl: string,
  providerType: Provider["providerType"] = "openai_chat"
): Provider {
  return { id: "p", name: "P", baseUrl, mode: "inject", providerType, apiKey: "k" };
}

function makeRouting(p: Provider): RoutingContext {
  return {
    blocked: false,
    method: "POST",
    path: "/v1/messages",
    provider: p,
    clientHeaders: {},
    headers: {},
    targetUrl: `${p.baseUrl}/v1/messages`,
    targetPath: "/v1/messages",
    targetQuery: "",
    isRouted: true,
    isOpenAIProvider: true,
    clientSurface: "anthropic",
  };
}

function anthropicBody(extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      model: "some-model",
      max_tokens: 256,
      stream: true,
      messages: [{ role: "user", content: "Hi" }],
      ...extra,
    }),
    "utf-8"
  );
}

function outBody(buf: Buffer): Record<string, unknown> {
  return JSON.parse(buf.toString("utf-8")) as Record<string, unknown>;
}

describe("BodyProcessor Anthropic→OpenAI Chat streaming", () => {
  it("keeps stream=true and requests usage for a plain Chat upstream", () => {
    const routing = makeRouting(provider("https://api.deepseek.com/v1"));
    const out = new BodyProcessor().process(anthropicBody(), routing, false);

    expect(out.streamRequested).toBe(true);
    expect(routing.targetPath).toContain("chat/completions");
    const body = outBody(out.body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("forces stream=false for platforms that rewrite the full completion", () => {
    const routing = makeRouting(provider("https://api.longcat.chat/openai"));
    const out = new BodyProcessor().process(anthropicBody(), routing, false);

    expect(out.streamRequested).toBe(true);
    const body = outBody(out.body);
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });

  it("forces stream=false when the request is upgraded to the Responses API", () => {
    const routing = makeRouting(provider("https://example.cognitiveservices.azure.com/openai/v1"));
    const out = new BodyProcessor().process(
      anthropicBody({ tools: [{ type: "web_search_20250305", name: "web_search" }] }),
      routing,
      false
    );

    expect(out.upstreamResponseFormat).toBe("responses");
    expect(outBody(out.body).stream).toBe(false);
  });

  it("leaves non-streaming requests unchanged", () => {
    const routing = makeRouting(provider("https://api.deepseek.com/v1"));
    const out = new BodyProcessor().process(anthropicBody({ stream: false }), routing, false);

    expect(out.streamRequested).toBeFalsy();
    const body = outBody(out.body);
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });
});
