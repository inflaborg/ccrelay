/* eslint-disable @typescript-eslint/naming-convention */

import { describe, expect, it } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

describe("BodyProcessor Azure OpenAI max_tokens normalization", () => {
  const azureOpenAi: Provider = {
    id: "azure-gpt",
    name: "Azure",
    baseUrl: "https://example.cognitiveservices.azure.com/openai/v1",
    mode: "passthrough",
    providerType: "openai",
    apiKey: "sk",
    modelMap: [{ pattern: "gpt-5.4", model: "prod-gpt5-eastus" }],
  };

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/openai/v1/chat/completions",
      provider: azureOpenAi,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://example.cognitiveservices.azure.com/openai/v1/chat/completions",
      targetPath: "/chat/completions",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: true,
      clientSurface: "openai",
      ...overrides,
    };
  }

  it("maps max_tokens to max_completion_tokens on OpenAI passthrough to Azure gpt-5", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 4096,
      })
    );
    const out = new BodyProcessor().process(body, makeRouting({}), false);
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.max_completion_tokens).toBe(4096);
    expect(parsed.max_tokens).toBeUndefined();
  });

  it("uses client model hint after deployment mapping for Anthropic inbound", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 8192,
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const out = new BodyProcessor().process(
      body,
      makeRouting({
        path: "/anthropic/v1/messages",
        clientSurface: "anthropic",
        targetPath: "/chat/completions",
      }),
      false
    );
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.model).toBe("prod-gpt5-eastus");
    expect(parsed.max_completion_tokens).toBe(8192);
    expect(parsed.max_tokens).toBeUndefined();
  });

  it("injects stream_options.include_usage for streaming OpenAI passthrough", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-5.4",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const out = new BodyProcessor().process(body, makeRouting({}), false);
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.stream_options).toEqual({ include_usage: true });
  });
});
