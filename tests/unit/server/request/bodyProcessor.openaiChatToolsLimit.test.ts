/* eslint-disable @typescript-eslint/naming-convention */

import { describe, expect, it } from "vitest";
import { OPENAI_CHAT_MAX_TOOLS } from "@/converter/platform-transforms";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

describe("BodyProcessor OpenAI Chat tools limit", () => {
  const openaiChat: Provider = {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    mode: "passthrough",
    providerType: "openai_chat",
    apiKey: "sk",
  };

  function makeRouting(overrides: Partial<RoutingContext> = {}): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/openai/v1/chat/completions",
      provider: openaiChat,
      clientHeaders: {},
      headers: {},
      targetUrl: "https://api.openai.com/v1/chat/completions",
      targetPath: "/chat/completions",
      targetQuery: "",
      isRouted: false,
      isOpenAIProvider: true,
      clientSurface: "openai",
      ...overrides,
    };
  }

  function fnTool(name: string): Record<string, unknown> {
    return {
      type: "function",
      function: {
        name,
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    };
  }

  it("truncates tools on Chat passthrough when over the OpenAI limit", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        tools: Array.from({ length: OPENAI_CHAT_MAX_TOOLS + 3 }, (_, i) => fnTool(`t${i}`)),
      })
    );
    const out = new BodyProcessor().process(body, makeRouting(), false);
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.tools).toHaveLength(OPENAI_CHAT_MAX_TOOLS);
  });

  it("truncates tools after Anthropic → Chat conversion", () => {
    const tools = Array.from({ length: OPENAI_CHAT_MAX_TOOLS + 2 }, (_, i) => ({
      name: `t${i}`,
      description: "d",
      input_schema: { type: "object", properties: {} },
    }));
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-4o",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
        tools,
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
    expect(parsed.tools).toHaveLength(OPENAI_CHAT_MAX_TOOLS);
  });
});
