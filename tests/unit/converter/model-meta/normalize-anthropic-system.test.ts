import { describe, expect, it } from "vitest";
import { hoistInlineSystemMessagesToAnthropicSystem } from "@/converter/model-meta/normalize-anthropic-system";

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic API bodies use snake_case */

describe("hoistInlineSystemMessagesToAnthropicSystem", () => {
  it("hoists string system message into top-level system", () => {
    const data: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "Skills list" },
      ],
    };
    expect(hoistInlineSystemMessagesToAnthropicSystem(data)).toBe(true);
    expect(data.system).toBe("Skills list");
    expect(data.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("appends hoisted content after existing system blocks", () => {
    const data: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "You are Claude Code.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "task" },
        { role: "system", content: "Available skills: godot, pdf" },
      ],
    };
    expect(hoistInlineSystemMessagesToAnthropicSystem(data)).toBe(true);
    expect(data.system).toEqual([
      {
        type: "text",
        text: "You are Claude Code.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "Available skills: godot, pdf" },
    ]);
    expect(data.messages).toEqual([{ role: "user", content: "task" }]);
  });

  it("hoists developer role and preserves cache_control on array content", () => {
    const data: Record<string, unknown> = {
      messages: [
        {
          role: "developer",
          content: [
            {
              type: "text",
              text: "Dev instructions",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
        { role: "user", content: "go" },
      ],
    };
    expect(hoistInlineSystemMessagesToAnthropicSystem(data)).toBe(true);
    expect(data.system).toEqual([
      {
        type: "text",
        text: "Dev instructions",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ]);
    expect(data.messages).toEqual([{ role: "user", content: "go" }]);
  });

  it("merges string existing system with hoisted string via block array", () => {
    const data: Record<string, unknown> = {
      system: "Prefix prompt.",
      messages: [{ role: "system", content: "Suffix skills." }],
    };
    expect(hoistInlineSystemMessagesToAnthropicSystem(data)).toBe(true);
    expect(data.system).toEqual([
      { type: "text", text: "Prefix prompt." },
      { type: "text", text: "Suffix skills." },
    ]);
  });

  it("returns false when no inline system messages exist", () => {
    const data: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
    };
    expect(hoistInlineSystemMessagesToAnthropicSystem(data)).toBe(false);
    expect(data.system).toBeUndefined();
  });
});
