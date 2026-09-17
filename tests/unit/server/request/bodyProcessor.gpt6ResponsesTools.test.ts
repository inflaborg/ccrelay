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

  it("forwards Anthropic user images as Responses input_image on gpt-6 tools", () => {
    const routing = makeRouting(openai);
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-6-astra",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: "abc",
                },
              },
            ],
          },
          { role: "user", content: "what is this" },
        ],
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
    const out = new BodyProcessor().process(body, routing, false);
    expect(out.upstreamResponseFormat).toBe("responses");
    const parsed = JSON.parse(out.body.toString("utf-8")) as {
      input: { role?: string; content?: { type?: string; image_url?: string; text?: string }[] }[];
    };
    expect(parsed.input[0]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/jpeg;base64,abc" }],
    });
    expect(parsed.input[1]?.content?.[0]).toEqual({ type: "input_text", text: "what is this" });
  });

  it("sends Anthropic hosted web_search tool_choice to Responses as type web_search", () => {
    const routing = makeRouting(openai);
    const body = Buffer.from(
      JSON.stringify({
        model: "gpt-6-astra",
        max_tokens: 64000,
        thinking: { type: "disabled" },
        output_config: { effort: "medium" },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Perform a web search for the query: test" }],
          },
        ],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            allowed_domains: [],
            blocked_domains: [],
            max_uses: 8,
          },
        ],
        tool_choice: { type: "tool", name: "web_search" },
      }),
      "utf-8"
    );
    const out = new BodyProcessor().process(body, routing, false);
    expect(out.upstreamResponseFormat).toBe("responses");
    expect(routing.targetPath).toBe("/responses");
    const parsed = JSON.parse(out.body.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.tool_choice).toEqual({ type: "web_search" });
    expect((parsed.tools as { type?: string }[])[0]?.type).toBe("web_search");
    expect(parsed.reasoning).toBeUndefined();
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
