import { applyPlatformRequestSanitize, minimaxChatSanitize } from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const MINIMAX_BASE = "https://api.minimax.io/v1";

describe("minimaxChatSanitize", () => {
  it("sets reasoning_split to true", () => {
    const body: Record<string, unknown> = { model: "MiniMax-M2.7", messages: [] };
    minimaxChatSanitize(body);
    expect(body.reasoning_split).toBe(true);
  });
});

describe("applyPlatformRequestSanitize (MiniMax)", () => {
  it("injects reasoning_split for api.minimax.io baseUrl", () => {
    const body: Record<string, unknown> = { model: "x", messages: [] };
    applyPlatformRequestSanitize(body, `${MINIMAX_BASE}/chat/completions`);
    expect(body.reasoning_split).toBe(true);
  });

  it("injects reasoning_split for api.minimaxi.com baseUrl", () => {
    const body: Record<string, unknown> = { model: "x", messages: [] };
    applyPlatformRequestSanitize(body, "https://api.minimaxi.com/v1/");
    expect(body.reasoning_split).toBe(true);
  });

  it("does not mutate unrelated upstream", () => {
    const body: Record<string, unknown> = { model: "x", messages: [] };
    applyPlatformRequestSanitize(body, "https://api.openai.com/v1");
    expect(body.reasoning_split).toBeUndefined();
  });
});
