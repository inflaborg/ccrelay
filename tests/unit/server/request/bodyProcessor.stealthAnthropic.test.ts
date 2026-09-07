import { describe, expect, it } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention */

describe("BodyProcessor OpenRouter stealth Anthropic outbound sanitize", () => {
  const openrouter: Provider = {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
    modelMap: [{ pattern: "claude-*", model: "stealth/ox-alpha" }],
    modelMappingEnabled: true,
  };

  function makeRouting(): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/v1/messages",
      provider: openrouter,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://openrouter.ai/api/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "?beta=true",
      isRouted: false,
      isOpenAIProvider: false,
      clientSurface: "anthropic",
    };
  }

  it("strips deferred tools after mapping claude-* to stealth/ox-alpha", () => {
    const input = {
      model: "claude-75987ea6",
      max_tokens: 32000,
      tools: [
        { name: "ToolSearch", input_schema: { type: "object" } },
        {
          name: "Bash",
          input_schema: { type: "object" },
          defer_loading: true,
        },
        {
          name: "DeferredToolPlaceholder",
          input_schema: { type: "object" },
          defer_loading: true,
        },
      ],
      messages: [{ role: "user", content: "hi" }],
    };

    const proc = new BodyProcessor();
    const result = proc.process(Buffer.from(JSON.stringify(input), "utf-8"), makeRouting(), false);
    const parsed = JSON.parse(result.body.toString("utf-8")) as Record<string, unknown>;

    expect(parsed.model).toBe("stealth/ox-alpha");
    expect(parsed.tools).toHaveLength(2);
    expect(JSON.stringify(parsed)).not.toContain("defer_loading");
    expect(JSON.stringify(parsed)).not.toContain("DeferredToolPlaceholder");
  });
});
