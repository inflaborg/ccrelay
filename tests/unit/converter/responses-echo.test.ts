/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import {
  extractResponsesEcho,
  extractFunctionToolsForEcho,
} from "@/converter/responses-echo";

describe("extractFunctionToolsForEcho", () => {
  it("keeps top-level type=function tools and drops hosted tools", () => {
    const raw = [
      { type: "function", name: "my_tool", parameters: {} },
      { type: "web_search" },
      { type: "mcp", connector_id: "x" },
    ];
    expect(extractFunctionToolsForEcho(raw)).toHaveLength(1);
    expect((extractFunctionToolsForEcho(raw)[0] as { name?: string }).name).toBe("my_tool");
  });

  it("expands namespace bundle inner function tools", () => {
    const raw = [
      {
        type: "namespace",
        tools: [{ type: "function", name: "inner_fn", parameters: { type: "object" } }],
      },
    ];
    expect(extractFunctionToolsForEcho(raw)).toHaveLength(1);
  });
});

describe("extractResponsesEcho", () => {
  it("echoes reasoning, parallel_tool_calls, metadata, instructions", () => {
    const echo = extractResponsesEcho({
      model: "gpt-5",
      tools: [{ type: "function", name: "x", parameters: {} }],
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      instructions: "be brief",
      metadata: { foo: "bar" },
      truncation: "auto",
      store: false,
      tool_choice: { type: "auto" },
    });
    expect(echo.tools).toHaveLength(1);
    expect(echo.parallel_tool_calls).toBe(false);
    expect(echo.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(echo.instructions).toBe("be brief");
    expect(echo.metadata).toEqual({ foo: "bar" });
    expect(echo.truncation).toBe("auto");
    expect(echo.store).toBe(false);
    expect(echo.tool_choice).toEqual({ type: "auto" });
  });
});
