/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Chat Completions wire field names */
import { describe, it, expect } from "vitest";
import { sanitizeOpenAiChatRequestRecord } from "@/converter/model-meta/sanitize-openai-chat";

describe("sanitizeOpenAiChatRequestRecord", () => {
  it("strips reasoning_effort when gpt-5 has function tools (Chat Completions limitation)", () => {
    const data: Record<string, unknown> = {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: {
            name: "exec_command",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      messages: [{ role: "user", content: "?" }],
    };
    sanitizeOpenAiChatRequestRecord(data);
    expect(data.reasoning_effort).toBeUndefined();
    expect(data.tools).toHaveLength(1);
  });

  it("keeps reasoning_effort for gpt-5 when there are no tools", () => {
    const data: Record<string, unknown> = {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      messages: [{ role: "user", content: "hi" }],
    };
    sanitizeOpenAiChatRequestRecord(data);
    expect(data.reasoning_effort).toBe("high");
  });

  it("keeps reasoning_effort with tools for DeepSeek chat models", () => {
    const data: Record<string, unknown> = {
      model: "deepseek-v4-flash",
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: { name: "exec_command", parameters: { type: "object" } },
        },
      ],
      messages: [{ role: "user", content: "?" }],
    };
    sanitizeOpenAiChatRequestRecord(data);
    expect(data.reasoning_effort).toBe("high");
  });
});
