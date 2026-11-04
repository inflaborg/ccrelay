/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions wire field names */
import { describe, it, expect } from "vitest";
import { coalesceLeadingSystemMessages } from "@/converter/chat-system-coalesce";
import type { OpenAIMessage } from "@/converter/adapters/anthropic-to-openai-chat-request";

describe("coalesceLeadingSystemMessages", () => {
  it("joins multiple system messages in order and keeps other roles", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are Codex." },
      { role: "user", content: "environment" },
      { role: "system", content: "timezone" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "hi" },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toEqual([
      { role: "system", content: "You are Codex.\n\ntimezone" },
      { role: "user", content: "environment" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "hi" },
    ]);
  });

  it("moves a single system that is not first", () => {
    const system: OpenAIMessage = { role: "system", content: "only" };
    const messages: OpenAIMessage[] = [
      { role: "user", content: "a" },
      system,
      { role: "assistant", content: "b" },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toEqual([
      system,
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("leaves a single leading system unchanged", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toBe(messages);
  });

  it("rewrites a lone leading developer message to system", () => {
    const messages: OpenAIMessage[] = [
      { role: "developer", content: "rules" },
      { role: "user", content: "hi" },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "hi" },
    ]);
  });

  it("drops empty system messages and does not invent one", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "system", content: "   " },
      { role: "developer", content: "" },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toEqual([{ role: "user", content: "hi" }]);
  });

  it("returns the same array when there is no system message", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: "hi" }];
    expect(coalesceLeadingSystemMessages(messages)).toBe(messages);
  });

  it("keeps images and joins surrounding text", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "system", content: "alpha" },
      {
        role: "developer",
        content: [
          { type: "text", text: "beta" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          { type: "text", text: "gamma" },
        ],
      },
    ];

    expect(coalesceLeadingSystemMessages(messages)).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "alpha\n\nbeta" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          { type: "text", text: "gamma" },
        ],
      },
      { role: "user", content: "hi" },
    ]);
  });
});
