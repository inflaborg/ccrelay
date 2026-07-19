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

  it("strips context_management for claude-opus by default", () => {
    const data: Record<string, unknown> = {
      model: "claude-opus-4-8",
      thinking: { type: "adaptive" },
      context_management: {
        edits: [{ type: "clear_thinking_20251015", keep: "all" }],
      },
      messages: [{ role: "user", content: "hi" }],
    };
    const meta = resolveModelMeta("claude-opus-4-8", { vendor: "anthropic" });
    const changes = sanitizeAnthropicRequestByMeta(data, meta);

    expect(changes).toContain("context_management");
    expect(data.context_management).toBeUndefined();
    expect(data.thinking).toEqual({ type: "adaptive" });
  });

  it("drops empty and whitespace-only thinking blocks from messages", () => {
    const data: Record<string, unknown> = {
      model: "claude-opus-4-8",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "   \n" },
            { type: "thinking", thinking: "" },
            { type: "thinking", signature: "sig_only" },
            { type: "thinking", thinking: "real plan" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    };
    const meta = resolveModelMeta("claude-opus-4-8", { vendor: "anthropic" });
    const changes = sanitizeAnthropicRequestByMeta(data, meta);

    expect(changes).toContain("messages.empty_thinking");
    expect((data.messages as { content: unknown[] }[])[1].content).toEqual([
      { type: "thinking", thinking: "real plan" },
      { type: "text", text: "answer" },
    ]);
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

  it("hoists inline system messages for haiku Cowork-style payload", () => {
    const data: Record<string, unknown> = {
      model: "claude-haiku-4-5",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
      system: [
        {
          type: "text",
          text: "You are Claude Code.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "Review the project." },
        { role: "system", content: "Available skills: godot, pdf" },
      ],
    };
    const meta = resolveModelMeta("claude-haiku-4-5", { vendor: "anthropic" });
    const changes = sanitizeAnthropicRequestByMeta(data, meta);

    expect(changes).toContain("messages.system->system");
    expect(changes).toContain("thinking");
    expect(changes).toContain("output_config.effort");
    expect(data.messages).toEqual([{ role: "user", content: "Review the project." }]);
    expect(data.system).toEqual([
      {
        type: "text",
        text: "You are Claude Code.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "Available skills: godot, pdf" },
    ]);
  });

  it("maps adaptive thinking to enabled and strips beta fields for glm-4.7", () => {
    const data: Record<string, unknown> = {
      model: "glm-4.7",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      context_management: {
        edits: [{ type: "clear_thinking_20251015", keep: "all" }],
      },
      tools: [
        { name: "ToolSearch", input_schema: { type: "object" } },
        {
          name: "WebSearch",
          input_schema: { type: "object" },
          defer_loading: true,
        },
        {
          name: "DeferredToolPlaceholder",
          description: "placeholder",
          input_schema: { type: "object" },
          defer_loading: true,
        },
      ],
      system: [
        {
          type: "text",
          text: "You are a Claude agent.",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        { role: "user", content: "search ghost in the shell" },
        { role: "system", content: "Deferred tools list" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan", signature: "" },
            { type: "text", text: "Searching." },
            {
              type: "tool_use",
              id: "call_1",
              name: "ToolSearch",
              input: { query: "select:WebSearch", max_results: 5 },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: [{ type: "tool_reference", tool_name: "WebSearch" }],
            },
            {
              type: "text",
              text: "Tool loaded.",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
      ],
    };
    const meta = resolveModelMeta("glm-4.7");
    const changes = sanitizeAnthropicRequestByMeta(data, meta);

    expect(meta.id).toBe("glm");
    expect(changes).toContain("thinking.adaptive->enabled");
    expect(changes).toContain("output_config.effort");
    expect(changes).toContain("context_management");
    expect(changes).toContain("tools.defer_loading");
    expect(changes).toContain("messages.system->system");
    expect(changes).toContain("tool_reference");
    expect(changes).toContain("cache_control.ttl");
    expect(data.thinking).toEqual({ type: "enabled" });
    expect(data.output_config).toBeUndefined();
    expect(data.context_management).toBeUndefined();
    expect(data.tools).toHaveLength(2);
    expect(
      (data.tools as { name?: string; defer_loading?: boolean }[]).every(
        t => t.defer_loading === undefined && t.name !== "DeferredToolPlaceholder"
      )
    ).toBe(true);
    expect(data.messages).toHaveLength(3);
    expect((data.system as { cache_control?: { ttl?: string } }[])[0].cache_control).toEqual({
      type: "ephemeral",
    });
    const userContent = (data.messages as { role: string; content: unknown[] }[])[2].content;
    expect(userContent[0]).toEqual({
      type: "tool_result",
      tool_use_id: "call_1",
      content: [{ type: "text", text: "Tool loaded: WebSearch." }],
    });
    expect((userContent[1] as { cache_control?: { ttl?: string } }).cache_control).toEqual({
      type: "ephemeral",
    });
  });
});
