/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformQueryPolicy,
  applyPlatformRequestSanitize,
  geminiChatSanitize,
  matchHostedToolRuleForBaseUrl,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

describe("Gemini platform rule", () => {
  it("matches generativelanguage.googleapis.com with stripQuery and requestSanitize", () => {
    const r = matchHostedToolRuleForBaseUrl(`${GEMINI_BASE}/chat/completions`);
    expect(r?.provider).toBe("gemini");
    expect(r?.stripQuery).toBe(true);
    expect(r?.requestSanitize).toBe("gemini-chat-sanitize");
  });
});

describe("applyPlatformQueryPolicy", () => {
  it("clears targetQuery and rebuilds targetUrl without query for Gemini upstream", () => {
    const routing = {
      targetUrl: `${GEMINI_BASE}/chat/completions?beta=true`,
      targetQuery: "?beta=true",
      targetPath: "/chat/completions",
      provider: { baseUrl: GEMINI_BASE },
    };
    applyPlatformQueryPolicy(routing);
    expect(routing.targetQuery).toBe("");
    expect(routing.targetUrl).toBe(`${GEMINI_BASE}/chat/completions`);
  });

  it("no-ops when targetQuery is empty", () => {
    const routing = {
      targetUrl: `${GEMINI_BASE}/chat/completions`,
      targetQuery: "",
      targetPath: "/chat/completions",
      provider: { baseUrl: GEMINI_BASE },
    };
    applyPlatformQueryPolicy(routing);
    expect(routing.targetUrl).toBe(`${GEMINI_BASE}/chat/completions`);
  });

  it("no-ops for hosts without stripQuery rule", () => {
    const routing = {
      targetUrl: "https://api.openai.com/v1/chat/completions?debug=1",
      targetQuery: "?debug=1",
      targetPath: "/v1/chat/completions",
      provider: { baseUrl: "https://api.openai.com/v1" },
    };
    applyPlatformQueryPolicy(routing);
    expect(routing.targetQuery).toBe("?debug=1");
    expect(routing.targetUrl).toContain("?");
  });
});

describe("geminiChatSanitize", () => {
  it("removes reasoning, message thinking, and non-function tools", () => {
    const body: Record<string, unknown> = {
      model: "gemini-pro",
      messages: [{ role: "assistant", content: "hi", thinking: { content: "x", signature: "s" } }],
      reasoning: { effort: "medium", enabled: true },
      tools: [
        { type: "function", function: { name: "a", parameters: {} } },
        { type: "custom", name: "c", description: "d", format: "json" },
        { type: "image_generation", output_format: "png" },
      ],
      tool_choice: "auto",
    };
    geminiChatSanitize(body);
    expect(body.reasoning).toBeUndefined();
    expect((body.messages as Record<string, unknown>[])[0].thinking).toBeUndefined();
    expect(body.tools).toHaveLength(1);
    expect((body.tools as Record<string, unknown>[])[0].type).toBe("function");
    expect(body.tool_choice).toBe("auto");
  });

  it("drops tools and tool_choice when no function tools remain", () => {
    const body: Record<string, unknown> = {
      model: "gemini-pro",
      messages: [],
      tools: [{ type: "custom", name: "c" }],
      tool_choice: "required",
    };
    geminiChatSanitize(body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("applyPlatformRequestSanitize", () => {
  it("runs gemini sanitizer for Gemini baseUrl", () => {
    const body: Record<string, unknown> = {
      model: "x",
      reasoning: { effort: "low" },
      messages: [],
    };
    applyPlatformRequestSanitize(body, `${GEMINI_BASE}/`);
    expect(body.reasoning).toBeUndefined();
  });

  it("does not mutate body for unrelated upstream", () => {
    const body: Record<string, unknown> = {
      model: "x",
      reasoning: { effort: "low" },
      messages: [],
    };
    applyPlatformRequestSanitize(body, "https://api.openai.com/v1");
    expect(body.reasoning).toEqual({ effort: "low" });
  });
});
