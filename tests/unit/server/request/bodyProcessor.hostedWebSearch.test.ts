import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

describe("BodyProcessor hasHostedWebSearch (/v1/messages canonical path)", () => {
  const glmAnthropic: Provider = {
    id: "glm",
    name: "GLM",
    baseUrl: "https://api.z.ai/api/anthropic",
    mode: "passthrough",
    providerType: "anthropic",
    apiKey: "sk",
  };

  function makeRouting(overrides: Partial<RoutingContext>): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider: glmAnthropic,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://api.z.ai/api/anthropic/v1/messages",
      targetPath: "/v1/messages",
      targetQuery: "?beta=true",
      isRouted: true,
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      ...overrides,
    };
  }

  const searchBody = Buffer.from(
    JSON.stringify({
      model: "glm-5-turbo",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
    "utf-8"
  );

  it("sets hasHostedWebSearch when inbound path is /anthropic/v1/messages", () => {
    const proc = new BodyProcessor();
    const out = proc.process(searchBody, makeRouting({}), false);
    expect(out.hasHostedWebSearch).toBe(true);
  });

  it("still sets flag for legacy inbound /v1/messages when targetPath is /v1/messages", () => {
    const proc = new BodyProcessor();
    const out = proc.process(
      searchBody,
      makeRouting({
        path: "/v1/messages",
        targetPath: "/v1/messages",
        targetUrl: "https://api.z.ai/api/anthropic/v1/messages",
      }),
      false
    );
    expect(out.hasHostedWebSearch).toBe(true);
  });

  it("does not infer hosted search from messages without tools[]", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "glm-5-turbo",
        stream: true,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "server_tool_use",
                id: "srv_1",
                name: "web_search",
                input: {},
              },
            ],
          },
        ],
      }),
      "utf-8"
    );
    expect(
      new BodyProcessor().process(body, makeRouting({}), false).hasHostedWebSearch
    ).toBeUndefined();
  });

  it("does not set flag without web_search tools", () => {
    const plain = Buffer.from(
      JSON.stringify({
        model: "glm-5-turbo",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "mcp_tools", type: "mcp_tools_xxx" }],
      }),
      "utf-8"
    );
    const proc = new BodyProcessor();
    expect(proc.process(plain, makeRouting({}), false).hasHostedWebSearch).toBeUndefined();
  });

  it("does not set flag when targetPath is not Messages (mis-stripped inbound)", () => {
    const proc = new BodyProcessor();
    const out = proc.process(
      searchBody,
      makeRouting({
        path: "/anthropic/v1/other",
        targetPath: "/v1/other",
        targetUrl: "https://api.z.ai/api/anthropic/v1/other",
      }),
      false
    );
    expect(out.hasHostedWebSearch).toBeUndefined();
  });
});
