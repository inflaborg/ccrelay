/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformQueryPolicy,
  applyPlatformRequestSanitize,
  canGeminiDisableThinking,
  geminiChatSanitize,
  matchHostedToolRuleForBaseUrl,
  normalizeGeminiEffort,
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

describe("canGeminiDisableThinking", () => {
  it("returns true for gemini-2.5-flash", () => {
    expect(canGeminiDisableThinking("gemini-2.5-flash")).toBe(true);
  });

  it("returns true for gemini-2.5-flash-lite", () => {
    expect(canGeminiDisableThinking("gemini-2.5-flash-lite")).toBe(true);
  });

  it("returns false for gemini-2.5-pro", () => {
    expect(canGeminiDisableThinking("gemini-2.5-pro")).toBe(false);
  });

  it("returns false for gemini-2.5-pro-preview", () => {
    expect(canGeminiDisableThinking("gemini-2.5-pro-preview")).toBe(false);
  });

  it("returns false for gemini-3-flash", () => {
    expect(canGeminiDisableThinking("gemini-3-flash")).toBe(false);
  });

  it("returns false for gemini-3.1-pro", () => {
    expect(canGeminiDisableThinking("gemini-3.1-pro")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(canGeminiDisableThinking("GEMINI-2.5-FLASH")).toBe(true);
  });
});

describe("normalizeGeminiEffort", () => {
  it("maps xhigh to high", () => {
    expect(normalizeGeminiEffort("xhigh", "gemini-2.5-flash")).toBe("high");
  });

  it("passes none for flash models", () => {
    expect(normalizeGeminiEffort("none", "gemini-2.5-flash")).toBe("none");
  });

  it("omits none for 2.5-pro", () => {
    expect(normalizeGeminiEffort("none", "gemini-2.5-pro")).toBeUndefined();
  });

  it("omits none for 3.x", () => {
    expect(normalizeGeminiEffort("none", "gemini-3-flash")).toBeUndefined();
  });

  it("passes medium for 3.x", () => {
    expect(normalizeGeminiEffort("medium", "gemini-3-flash")).toBe("medium");
  });

  it("omits unknown effort", () => {
    expect(normalizeGeminiEffort("unknown", "gemini-2.5-flash")).toBeUndefined();
  });
});

describe("geminiChatSanitize", () => {
  it("normalizes reasoning_effort and strips legacy reasoning", () => {
    const body: Record<string, unknown> = {
      model: "gemini-pro",
      messages: [{ role: "assistant", content: "hi", thinking: { content: "x", signature: "s" } }],
      reasoning_effort: "medium",
      reasoning: { effort: "ignored" },
      tools: [
        { type: "function", function: { name: "a", parameters: {} } },
        { type: "custom", name: "c", description: "d", format: "json" },
        { type: "image_generation", output_format: "png" },
      ],
      tool_choice: "auto",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.reasoning).toBeUndefined();
    expect((body.messages as Record<string, unknown>[])[0].thinking).toBeUndefined();
    expect(body.tools).toHaveLength(1);
    expect((body.tools as Record<string, unknown>[])[0].type).toBe("function");
    expect(body.tool_choice).toBe("auto");
  });

  it("does not add reasoning_effort when absent", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-flash",
      messages: [],
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("strips legacy nested reasoning object without setting reasoning_effort", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-flash",
      messages: [],
      reasoning: {},
    };
    geminiChatSanitize(body);
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("passes none for 2.5-flash", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-flash",
      messages: [],
      reasoning_effort: "none",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBe("none");
    expect(body.reasoning).toBeUndefined();
  });

  it("omits reasoning_effort for none on 2.5-pro", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-pro",
      messages: [],
      reasoning_effort: "none",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("omits reasoning_effort for none on 3.x", () => {
    const body: Record<string, unknown> = {
      model: "gemini-3-flash",
      messages: [],
      reasoning_effort: "none",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("maps xhigh to high", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-flash",
      messages: [],
      reasoning_effort: "xhigh",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });

  it("omits reasoning_effort for bogus effort", () => {
    const body: Record<string, unknown> = {
      model: "gemini-2.5-flash",
      messages: [],
      reasoning_effort: "bogus",
    };
    geminiChatSanitize(body);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
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
      model: "gemini-2.5-flash",
      reasoning_effort: "low",
      messages: [],
    };
    applyPlatformRequestSanitize(body, `${GEMINI_BASE}/`);
    expect(body.reasoning_effort).toBe("low");
    expect(body.reasoning).toBeUndefined();
  });

  it("does not mutate body for unrelated upstream", () => {
    const body: Record<string, unknown> = {
      model: "x",
      reasoning_effort: "low",
      messages: [],
    };
    applyPlatformRequestSanitize(body, "https://api.openai.com/v1");
    expect(body.reasoning_effort).toBe("low");
  });
});
