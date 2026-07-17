import { describe, expect, it } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention */

describe("BodyProcessor GLM Anthropic outbound sanitize", () => {
  const glmUpstream: Provider = {
    id: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
    modelMap: [{ pattern: "claude-*", model: "glm-4.7" }],
    modelMappingEnabled: true,
  };

  function makeRouting(): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider: glmUpstream,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://open.bigmodel.cn/api/anthropic/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: false,
      clientSurface: "anthropic",
    };
  }

  it("sanitizes Cowork-style payload after model mapping to glm-4.7", () => {
    const input = {
      model: "claude-93e5ab20",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      context_management: {
        edits: [{ type: "clear_thinking_20251015", keep: "all" }],
      },
      tools: [
        { name: "ToolSearch", input_schema: { type: "object" } },
        {
          name: "WebSearch",
          input_schema: { type: "object" },
          defer_loading: true,
        },
        {
          name: "DeferredToolPlaceholder",
          input_schema: { type: "object" },
          defer_loading: true,
        },
      ],
      system: [
        {
          type: "text",
          text: "You are a Claude agent.",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        { role: "user", content: "search ghost in the shell" },
        { role: "system", content: "Deferred tools available" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Searching." },
            {
              type: "tool_use",
              id: "call_1",
              name: "ToolSearch",
              input: { query: "select:WebSearch", max_results: 5 },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: [{ type: "tool_reference", tool_name: "WebSearch" }],
            },
            {
              type: "text",
              text: "Tool loaded.",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
      ],
    };

    const proc = new BodyProcessor();
    const result = proc.process(Buffer.from(JSON.stringify(input), "utf-8"), makeRouting(), false);
    const parsed = JSON.parse(result.body.toString("utf-8")) as Record<string, unknown>;

    expect(parsed.model).toBe("glm-4.7");
    expect(parsed.thinking).toEqual({ type: "enabled" });
    expect(parsed.output_config).toBeUndefined();
    expect(parsed.context_management).toBeUndefined();
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.messages).toHaveLength(3);
    expect(JSON.stringify(parsed)).not.toContain("tool_reference");
    expect(JSON.stringify(parsed)).not.toContain("defer_loading");
    expect(JSON.stringify(parsed)).not.toContain("DeferredToolPlaceholder");
    expect(JSON.stringify(parsed)).not.toContain('"ttl":"1h"');
  });
});
