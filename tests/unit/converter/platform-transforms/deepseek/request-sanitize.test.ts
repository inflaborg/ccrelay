/* eslint-disable @typescript-eslint/naming-convention */

import {
  applyPlatformRequestSanitize,
  deepseekChatSanitize,
  matchHostedToolRuleForBaseUrl,
  normalizeDeepseekEffort,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

describe("DeepSeek platform rule", () => {
  it("matches api.deepseek.com with requestSanitize", () => {
    const r = matchHostedToolRuleForBaseUrl(`${DEEPSEEK_BASE}/chat/completions`);
    expect(r?.provider).toBe("deepseek");
    expect(r?.requestSanitize).toBe("deepseek-chat-sanitize");
  });
});

describe("normalizeDeepseekEffort", () => {
  it("maps low, medium, minimal to high", () => {
    expect(normalizeDeepseekEffort("low")).toBe("high");
    expect(normalizeDeepseekEffort("medium")).toBe("high");
    expect(normalizeDeepseekEffort("minimal")).toBe("high");
  });

  it("maps xhigh to max", () => {
    expect(normalizeDeepseekEffort("xhigh")).toBe("max");
  });

  it("passes through high and max", () => {
    expect(normalizeDeepseekEffort("high")).toBe("high");
    expect(normalizeDeepseekEffort("max")).toBe("max");
  });
});

describe("deepseekChatSanitize", () => {
  it("no-ops when reasoning_effort is absent", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      messages: [],
      temperature: 0.7,
    };
    deepseekChatSanitize(body);
    expect(body).toEqual({
      model: "deepseek-v4-pro",
      messages: [],
      temperature: 0.7,
    });
  });

  it("no-ops when reasoning_effort is blank", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      reasoning_effort: "   ",
      messages: [],
    };
    deepseekChatSanitize(body);
    expect(body.reasoning_effort).toBe("   ");
    expect(body.thinking).toBeUndefined();
  });

  it("sets thinking disabled and removes effort for none", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      reasoning_effort: "none",
      messages: [],
    };
    deepseekChatSanitize(body);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.messages).toEqual([]);
  });

  it("enables thinking, normalizes effort, strips sampling fields", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      reasoning_effort: "medium",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.5,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
    };
    deepseekChatSanitize(body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.presence_penalty).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("maps xhigh to max when enabled", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      reasoning_effort: "xhigh",
      messages: [],
    };
    deepseekChatSanitize(body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
  });

  it("preserves high and max", () => {
    const highBody: Record<string, unknown> = {
      model: "deepseek-v4-flash",
      reasoning_effort: "high",
      messages: [],
    };
    deepseekChatSanitize(highBody);
    expect(highBody.reasoning_effort).toBe("high");

    const maxBody: Record<string, unknown> = {
      model: "deepseek-v4-flash",
      reasoning_effort: "max",
      messages: [],
    };
    deepseekChatSanitize(maxBody);
    expect(maxBody.reasoning_effort).toBe("max");
  });
});

describe("applyPlatformRequestSanitize (DeepSeek)", () => {
  it("runs deepseek sanitizer for DeepSeek baseUrl", () => {
    const body: Record<string, unknown> = {
      model: "deepseek-v4-pro",
      reasoning_effort: "low",
      messages: [],
      temperature: 1,
    };
    applyPlatformRequestSanitize(body, `${DEEPSEEK_BASE}/`);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.temperature).toBeUndefined();
  });

  it("does not mutate body for unrelated upstream", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4",
      reasoning_effort: "low",
      temperature: 0.5,
    };
    applyPlatformRequestSanitize(body, "https://api.openai.com/v1");
    expect(body.reasoning_effort).toBe("low");
    expect(body.temperature).toBe(0.5);
    expect(body.thinking).toBeUndefined();
  });
});
