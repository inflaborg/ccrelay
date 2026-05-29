import {
  applyAnthropicRequestSanitize,
  mimoAnthropicRequestSanitize,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const MIMO_API_BASE = "https://api.xiaomimimo.com/anthropic";
const MIMO_TOKEN_PLAN_BASE = "https://token-plan-sgp.xiaomimimo.com/anthropic";

describe("mimoAnthropicRequestSanitize", () => {
  it("rewrites a system-role message to user and merges with the preceding user message", () => {
    const body: Record<string, unknown> = {
      model: "mimo-v2.5-pro",
      system: [{ type: "text", text: "top-level system" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "system", content: "available skills..." },
      ],
    };
    mimoAnthropicRequestSanitize(body);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "available skills..." },
        ],
      },
    ]);
    // Top-level system is left untouched.
    expect(body.system).toEqual([{ type: "text", text: "top-level system" }]);
  });

  it("keeps roles separate when no merge is needed", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "assistant", content: "prev answer" },
        { role: "system", content: "mid-conversation note" },
      ],
    };
    mimoAnthropicRequestSanitize(body);
    // Non-merged messages keep their original content shape (string stays string).
    expect(body.messages).toEqual([
      { role: "assistant", content: "prev answer" },
      { role: "user", content: "mid-conversation note" },
    ]);
  });

  it("merges multiple consecutive same-role messages after rewrite", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "user", content: "a" },
        { role: "system", content: "b" },
        { role: "system", content: "c" },
        { role: "assistant", content: "d" },
      ],
    };
    mimoAnthropicRequestSanitize(body);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
          { type: "text", text: "c" },
        ],
      },
      { role: "assistant", content: "d" },
    ]);
  });

  it("does nothing when there is no system-role message", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    };
    mimoAnthropicRequestSanitize(body);
    expect(body.messages).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });
});

describe("applyAnthropicRequestSanitize (MiMo)", () => {
  it("applies for api.xiaomimimo.com", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "skills" },
      ],
    };
    applyAnthropicRequestSanitize(body, `${MIMO_API_BASE}/v1/messages`);
    expect((body.messages as unknown[]).length).toBe(1);
    expect((body.messages as Array<{ role: string }>)[0].role).toBe("user");
  });

  it("applies for token-plan subdomain", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "system", content: "skills" }],
    };
    applyAnthropicRequestSanitize(body, `${MIMO_TOKEN_PLAN_BASE}/v1/messages`);
    expect((body.messages as Array<{ role: string }>)[0].role).toBe("user");
  });

  it("does not mutate unrelated anthropic upstream", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "skills" },
      ],
    };
    applyAnthropicRequestSanitize(body, "https://api.anthropic.com/v1/messages");
    expect((body.messages as unknown[]).length).toBe(2);
    expect((body.messages as Array<{ role: string }>)[1].role).toBe("system");
  });
});
