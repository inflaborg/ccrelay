import { describe, it, expect } from "vitest";
import {
  anthropicBodyHasHostedTool,
  chatBodyHasHostedTool,
  detectChatHostedToolKinds,
} from "@/converter/hosted-tools";

describe("chatBodyHasHostedTool", () => {
  it("detects web_search and web_search_* Chat types", () => {
    expect(chatBodyHasHostedTool({ tools: [{ type: "web_search" }] }, "web_search")).toBe(true);
    expect(
      chatBodyHasHostedTool(
        { tools: [{ type: "web_search_20250305", name: "web_search" }] },
        "web_search"
      )
    ).toBe(true);
  });

  it("detects code_interpreter Chat type", () => {
    expect(
      chatBodyHasHostedTool({ tools: [{ type: "code_interpreter" }] }, "code_interpreter")
    ).toBe(true);
  });

  it("detects text_editor Chat type", () => {
    expect(chatBodyHasHostedTool({ tools: [{ type: "text_editor" }] }, "text_editor")).toBe(true);
  });

  it("is false when tools omit hosted kinds", () => {
    expect(
      chatBodyHasHostedTool(
        {
          tools: [{ type: "function", function: { name: "x", parameters: {} } }],
        },
        "web_search"
      )
    ).toBe(false);
  });

  it("is false without tools array", () => {
    expect(chatBodyHasHostedTool({ model: "x" }, "web_search")).toBe(false);
  });
});

describe("anthropicBodyHasHostedTool", () => {
  it("detects versioned web_search server tool", () => {
    expect(
      anthropicBodyHasHostedTool(
        { tools: [{ type: "web_search_20250305", name: "web_search" }] },
        "web_search"
      )
    ).toBe(true);
  });

  it("detects code_execution Anthropic type as code_interpreter kind", () => {
    expect(
      anthropicBodyHasHostedTool(
        { tools: [{ type: "code_execution_20250522", name: "code_execution" }] },
        "code_interpreter"
      )
    ).toBe(true);
  });

  it("detects text_editor Anthropic type", () => {
    expect(
      anthropicBodyHasHostedTool(
        { tools: [{ type: "text_editor_20250124", name: "text_editor" }] },
        "text_editor"
      )
    ).toBe(true);
  });

  it("is false without tools", () => {
    expect(anthropicBodyHasHostedTool({ model: "x" }, "web_search")).toBe(false);
  });

  it("is false when messages suggest search but tools[] is omitted", () => {
    expect(
      anthropicBodyHasHostedTool(
        {
          model: "x",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "server_tool_use",
                  id: "toolu_123",
                  name: "web_search",
                  input: { query: "q" },
                },
              ],
            },
          ],
        },
        "web_search"
      )
    ).toBe(false);
  });
});

describe("detectChatHostedToolKinds", () => {
  it("returns distinct kinds for mixed Chat tools", () => {
    const kinds = detectChatHostedToolKinds({
      tools: [
        { type: "web_search" },
        { type: "code_interpreter" },
        { type: "function", function: { name: "x", parameters: {} } },
      ],
    });
    expect(kinds.sort()).toEqual(["code_interpreter", "web_search"]);
  });
});
