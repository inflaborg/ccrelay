/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformRequestSanitize,
  azureChatSanitize,
  matchHostedToolRuleForBaseUrl,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const AZURE_BASE = "https://example.cognitiveservices.azure.com/openai/v1";

describe("Azure OpenAI platform rule", () => {
  it("matches cognitiveservices.azure.com with requestSanitize", () => {
    const r = matchHostedToolRuleForBaseUrl(`${AZURE_BASE}/chat/completions`);
    expect(r?.provider).toBe("azure-openai");
    expect(r?.requestSanitize).toBe("azure-chat-sanitize");
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
});
