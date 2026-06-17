import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention */

const BILLING_TEXT =
  "x-anthropic-billing-header: cc_version=2.1.177.e2d; cc_entrypoint=local-agent; cch=c76d1;";

describe("BodyProcessor billing header sanitization", () => {
  const anthropicUpstream: Provider = {
    id: "official",
    name: "Official",
    baseUrl: "https://api.anthropic.com",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
  };

  const openaiUpstream: Provider = {
    id: "mimo",
    name: "Mimo",
    baseUrl: "https://example.com/v1",
    mode: "passthrough",
    providerType: "openai_chat",
    apiKey: "sk",
  };

  function makeAnthropicRequestBody(): Buffer {
    return Buffer.from(
      JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hello" }],
        system: [
          { type: "text", text: BILLING_TEXT },
          { type: "text", text: "You are a Claude agent." },
        ],
      }),
      "utf-8"
    );
  }

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider: anthropicUpstream,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://api.anthropic.com/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      ...overrides,
    };
  }

  it("strips billing header on anthropic -> anthropic passthrough", () => {
    const routing = makeRouting({ provider: anthropicUpstream });
    const proc = new BodyProcessor();
    const result = proc.process(makeAnthropicRequestBody(), routing, false);

    const parsed = JSON.parse(result.body.toString("utf-8")) as {
      system?: { text: string }[];
    };
    expect(parsed.system).toHaveLength(1);
    expect(parsed.system?.[0].text).toBe("You are a Claude agent.");
    expect(JSON.stringify(parsed)).not.toContain("x-anthropic-billing-header");
  });

  it("strips billing header on anthropic -> openai conversion", () => {
    const routing = makeRouting({
      provider: openaiUpstream,
      isOpenAIProvider: true,
      targetUrl: "https://example.com/v1/v1/messages",
    });
    const proc = new BodyProcessor();
    const result = proc.process(makeAnthropicRequestBody(), routing, false);

    const parsed = JSON.parse(result.body.toString("utf-8")) as {
      messages: { role: string; content: unknown }[];
    };
    expect(JSON.stringify(parsed)).not.toContain("x-anthropic-billing-header");
    const systemMsg = parsed.messages.find(m => m.role === "system");
    expect(systemMsg).toBeDefined();
    if (Array.isArray(systemMsg?.content)) {
      const texts = systemMsg.content.map((p: { text?: string }) => p.text);
      expect(texts).toEqual(["You are a Claude agent."]);
    }
  });
});
