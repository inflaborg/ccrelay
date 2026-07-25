/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformRequestSanitize,
  azureChatSanitize,
  matchHostedToolRuleForBaseUrl,
  openaiChatStrictToolsSanitize,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const AZURE_BASE = "https://example.cognitiveservices.azure.com/openai/v1";

describe("Azure OpenAI platform rule", () => {
  it("matches cognitiveservices.azure.com with requestSanitize and strictTools", () => {
    const r = matchHostedToolRuleForBaseUrl(`${AZURE_BASE}/chat/completions`);
    expect(r?.provider).toBe("azure-openai");
    expect(r?.requestSanitize).toBe("azure-chat-sanitize");
    expect(r?.strictTools).toBe(true);
  });

  it("matches openaiCompat azure_openai on custom domains", () => {
    const r = matchHostedToolRuleForBaseUrl("https://llm-router.bizs.app/v1", {
      openaiCompat: "azure_openai",
    });
    expect(r?.provider).toBe("azure-openai");
    expect(r?.strictTools).toBe(true);
    expect(r?.requestSanitize).toBe("azure-chat-sanitize");
  });

  it("does not match custom domains without openaiCompat", () => {
    expect(matchHostedToolRuleForBaseUrl("https://llm-router.bizs.app/v1")).toBeUndefined();
  });
});

describe("azureChatSanitize", () => {
  it("strips legacy reasoning, preserves reasoning_effort, cache_control, assistant thinking, tool extra_content", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      reasoning_effort: "medium",
      reasoning: { effort: "should-strip" },
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: "system-a", cache_control: { type: "ephemeral" } }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
        },
        {
          role: "assistant",
          thinking: { content: "t1", signature: "sig1" },
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "noop", arguments: "{}" },
              extra_content: { google: { thought_signature: "x" } },
            },
          ],
        },
      ],
    };
    azureChatSanitize(body);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.reasoning).toBeUndefined();
    const sys = (body.messages as Record<string, unknown>[])[0];
    expect((sys.content as { cache_control?: unknown }[])[0].cache_control).toBeUndefined();
    const user = (body.messages as Record<string, unknown>[])[1];
    expect((user.content as { cache_control?: unknown }[])[0].cache_control).toBeUndefined();
    const asst = (body.messages as Record<string, unknown>[])[2];
    expect(asst.thinking).toBeUndefined();
    expect((asst.tool_calls as Record<string, unknown>[])[0].extra_content).toBeUndefined();
    expect((asst.tool_calls as { function: { name: string } }[])[0].function.name).toBe("noop");
  });

  it("maps developer role to system for Azure Chat Completions schema", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      messages: [
        { role: "developer", content: "You are Codex." },
        { role: "developer", content: "<permissions instructions>" },
        { role: "user", content: "hi" },
      ],
    };
    azureChatSanitize(body);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map(m => m.role)).toEqual(["system", "system", "user"]);
    expect(messages[0].content).toBe("You are Codex.");
  });
});

describe("applyPlatformRequestSanitize (Azure)", () => {
  it("invokes azure-chat-sanitize for Azure OpenAI base URL", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      reasoning_effort: "low",
      messages: [{ role: "assistant", content: "x", thinking: { content: "t" } }],
    };
    applyPlatformRequestSanitize(body, AZURE_BASE);
    expect(body.reasoning_effort).toBe("low");
    expect((body.messages as Record<string, unknown>[])[0].thinking).toBeUndefined();
  });

  it("maps developer roles via applyPlatformRequestSanitize", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      messages: [{ role: "developer", content: "sys" }],
    };
    applyPlatformRequestSanitize(body, AZURE_BASE);
    expect((body.messages as { role: string }[])[0].role).toBe("system");
  });

  it("applies azure-chat-sanitize via openaiCompat on custom domains", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      messages: [{ role: "developer", content: "sys" }],
      tools: [{ type: "custom", name: "exec", description: "Run JS" }],
    };
    applyPlatformRequestSanitize(body, "https://llm-router.bizs.app/v1", {
      openaiCompat: "azure_openai",
    });
    openaiChatStrictToolsSanitize(body, "https://llm-router.bizs.app/v1", {
      openaiCompat: "azure_openai",
    });
    expect((body.messages as { role: string }[])[0].role).toBe("system");
    expect((body.tools as Record<string, unknown>[])[0]).toMatchObject({
      type: "function",
      function: { name: "exec" },
    });
  });
});
