import { describe, it, expect } from "vitest";
import { BodyProcessor } from "@/server/request/bodyProcessor";
import type { RoutingContext } from "@/server/request/context";
import type { Provider } from "@/types";

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic / OpenAI wire field names in fixtures */

describe("BodyProcessor Responses vs Chat-only for gpt-5/gpt-6 tools", () => {
  const openai: Provider = {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    mode: "inject",
    providerType: "openai",
    apiKey: "k",
  };

  const openaiChatOnly: Provider = {
    ...openai,
    id: "openai-chat",
    name: "OpenAI Chat",
    providerType: "openai_chat",
  };

  function makeRouting(provider: Provider): RoutingContext {
    return {
      blocked: false,
      method: "POST",
      path: "/anthropic/v1/messages",
      provider,
      clientHeaders: {},
      headers: {},
      targetUrl: `${provider.baseUrl}/v1/messages`,
      targetPath: "/v1/messages",
      targetQuery: "",
      isRouted: true,
      isOpenAIProvider: true,
      clientSurface: "anthropic",
    };
  }

  const anthropicBody = (model: string) =>
    Buffer.from(
      JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello." },
          { role: "user", content: "Again" },
        ],
        thinking: { type: "enabled", budget_tokens: 8000 },
        tools: [
          {
            name: "exec_command",
            description: "Run a command",
            input_schema: { type: "object", properties: {} },
          },
        ],
      }),
      "utf-8"
    );

  it("sends gpt-6-astra function tools to POST /responses when providerType is openai", () => {
    const routing = makeRouting(openai);
    const out = new BodyProcessor().process(anthropicBody("gpt-6-astra"), routing, false);

    expect(out.upstreamResponseFormat).toBe("responses");
    expect(routing.targetPath).toBe("/responses");

    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.stream).toBe(false);
    expect(parsed.model).toBe("gpt-6-astra");
    expect(parsed.reasoning).toEqual({ effort: "high" });
    expect((parsed.tools as { name?: string }[])[0]?.name).toBe("exec_command");
    const input = parsed.input as { role?: string; content?: { type?: string }[] }[];
    const assistant = input.find(i => i.role === "assistant");
    expect(assistant?.content?.[0]?.type).toBe("output_text");
  });

  it("sends gpt-5.6 function tools to POST /responses when providerType is openai", () => {
    const routing = makeRouting(openai);
    const out = new BodyProcessor().process(anthropicBody("gpt-5.6-terra"), routing, false);

    expect(out.upstreamResponseFormat).toBe("responses");
    expect(routing.targetPath).toBe("/responses");
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.reasoning).toEqual({ effort: "high" });
  });

  it("keeps Chat Completions on openai_chat and remaps gpt-6 none instead of calling /responses", () => {
    const routing = makeRouting(openaiChatOnly);
    const out = new BodyProcessor().process(anthropicBody("gpt-6-astra"), routing, false);

    expect(out.upstreamResponseFormat).toBeUndefined();
    expect(routing.targetPath).toContain("chat");

    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.reasoning_effort).toBe("high");
    expect(parsed.max_completion_tokens).toBe(1024);
    expect(parsed.input).toBeUndefined();
  });

  it("keeps Chat Completions on openai_chat and forces reasoning_effort none for gpt-5.4 tools", () => {
    const routing = makeRouting(openaiChatOnly);
    const out = new BodyProcessor().process(anthropicBody("gpt-5.4"), routing, false);

    expect(out.upstreamResponseFormat).toBeUndefined();
    expect(routing.targetPath).toContain("chat");

    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.reasoning_effort).toBe("none");
    expect(parsed.max_completion_tokens).toBe(1024);
  });
});
