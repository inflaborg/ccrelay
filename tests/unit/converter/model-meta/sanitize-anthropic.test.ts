import { describe, expect, it } from "vitest";
import { resolveModelMeta } from "@/converter/model-meta/registry";
import { sanitizeAnthropicRequestByMeta } from "@/converter/model-meta/sanitize-anthropic";

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic API bodies use snake_case */

describe("sanitizeAnthropicRequestByMeta", () => {
  it("strips effort and thinking for claude-haiku (Cowork-style payload)", () => {
    const data: Record<string, unknown> = {
      model: "claude-haiku-4-5",
      max_tokens: 32000,
      thinking: { type: "enabled", budget_tokens: 31999 },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: "hi" }],
    };
    const meta = resolveModelMeta("claude-haiku-4-5", { vendor: "anthropic" });
    const stripped = sanitizeAnthropicRequestByMeta(data, meta);

    expect(stripped).toContain("output_config.effort");
    expect(stripped).toContain("thinking");
    expect(data.thinking).toBeUndefined();
    expect(data.output_config).toBeUndefined();
  });

  it("preserves effort and thinking for claude-sonnet", () => {
    const data: Record<string, unknown> = {
      model: "claude-sonnet-4-20250514",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: "hi" }],
    };
    const meta = resolveModelMeta("claude-sonnet-4-20250514", { vendor: "anthropic" });
    const stripped = sanitizeAnthropicRequestByMeta(data, meta);

    expect(stripped).toHaveLength(0);
    expect(data.output_config).toEqual({ effort: "medium" });
    expect(data.thinking).toEqual({ type: "adaptive" });
  });

  it("removes only effort when output_config has other keys", () => {
    const data: Record<string, unknown> = {
      model: "claude-haiku-4-5",
      output_config: { effort: "medium", format: { type: "text" } },
      messages: [],
    };
    const meta = resolveModelMeta("claude-haiku-4-5", { vendor: "anthropic" });
    sanitizeAnthropicRequestByMeta(data, meta);

    expect(data.output_config).toEqual({ format: { type: "text" } });
  });
});
