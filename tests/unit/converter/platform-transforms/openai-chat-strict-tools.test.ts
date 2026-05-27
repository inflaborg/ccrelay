/* eslint-disable @typescript-eslint/naming-convention */

import {
  customToFunctionShim,
  matchHostedToolRuleForBaseUrl,
  openaiChatStrictToolsSanitize,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const MIMO_API = "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_TOKEN_PLAN = "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions";
const UNKNOWN = "https://api.openai.com/v1/chat/completions";

function fnTool(name: string): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name,
      description: "d",
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("matchHostedToolRuleForBaseUrl — xiaomimimo token-plan", () => {
  it("matches api.xiaomimimo.com to xiaomimimo rule", () => {
    const r = matchHostedToolRuleForBaseUrl(MIMO_API);
    expect(r?.provider).toBe("xiaomimimo");
    expect(r?.strictTools).toBe(true);
  });

  it("matches token-plan subdomain to xiaomimimo-token-plan rule", () => {
    const r = matchHostedToolRuleForBaseUrl(MIMO_TOKEN_PLAN);
    expect(r?.provider).toBe("xiaomimimo-token-plan");
    expect(r?.strictTools).toBe(true);
    expect(r?.tools).toBeUndefined();
  });
});

describe("customToFunctionShim", () => {
  it("maps custom apply_patch to function with string input and grammar in description", () => {
    const shimmed = customToFunctionShim({
      type: "custom",
      name: "apply_patch",
      description: "Use apply_patch for edits.",
      format: { type: "grammar", syntax: "lark", definition: "start: patch" },
    });
    expect(shimmed.type).toBe("function");
    const fn = shimmed.function as Record<string, unknown>;
    expect(fn.name).toBe("apply_patch");
    expect(String(fn.description)).toContain("grammar");
    expect(String(fn.description)).toContain("start: patch");
    const params = fn.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect((props.input as Record<string, unknown>).type).toBe("string");
    expect(params.required).toEqual(["input"]);
  });
});

describe("openaiChatStrictToolsSanitize", () => {
  it("no-ops when baseUrl has no strictTools rule", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "web_search" }, fnTool("a")],
    };
    openaiChatStrictToolsSanitize(body, UNKNOWN);
    expect(body.tools).toHaveLength(2);
  });

  it("keeps function + web_search on api.xiaomimimo.com, drops other hosted types", () => {
    const body: Record<string, unknown> = {
      tools: [
        fnTool("exec_command"),
        { type: "custom", name: "apply_patch", description: "patch" },
        { type: "tool_search", name: "search" },
        { type: "web_search", external_web_access: true },
        { type: "image_generation", output_format: "png" },
      ],
    };
    openaiChatStrictToolsSanitize(body, MIMO_API);
    const tools = body.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(3);
    expect(tools.some(t => (t.function as Record<string, unknown>)?.name === "exec_command")).toBe(
      true
    );
    expect(tools.some(t => (t.function as Record<string, unknown>)?.name === "apply_patch")).toBe(
      true
    );
    expect(tools.some(t => t.type === "web_search")).toBe(true);
    expect(tools.some(t => t.type === "tool_search")).toBe(false);
    expect(tools.some(t => t.type === "image_generation")).toBe(false);
  });

  it("on token-plan host keeps only function tools (drops web_search)", () => {
    const body: Record<string, unknown> = {
      tools: [fnTool("a"), { type: "web_search" }, { type: "image_generation" }],
    };
    openaiChatStrictToolsSanitize(body, MIMO_TOKEN_PLAN);
    const tools = body.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    expect((tools[0].function as Record<string, unknown>).name).toBe("a");
  });

  it("shims custom apply_patch to function on token-plan", () => {
    const body: Record<string, unknown> = {
      tools: [
        fnTool("exec"),
        { type: "custom", name: "apply_patch", description: "freeform patch tool" },
      ],
    };
    openaiChatStrictToolsSanitize(body, MIMO_TOKEN_PLAN);
    const tools = body.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(2);
    const patch = tools.find(t => (t.function as Record<string, unknown>)?.name === "apply_patch");
    expect(patch?.type).toBe("function");
  });

  it("falls back tool_choice to auto when named tool was dropped", () => {
    const body: Record<string, unknown> = {
      tools: [fnTool("keep_me"), { type: "tool_search" }],
      tool_choice: { type: "function", function: { name: "missing_tool" } },
    };
    openaiChatStrictToolsSanitize(body, MIMO_TOKEN_PLAN);
    expect(body.tool_choice).toBe("auto");
  });

  it("rewrites custom tool_choice to function when custom was shimmed", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "custom", name: "apply_patch", description: "x" }],
      tool_choice: { type: "custom", name: "apply_patch" },
    };
    openaiChatStrictToolsSanitize(body, MIMO_TOKEN_PLAN);
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "apply_patch" } });
  });

  it("removes tools field when every entry is dropped", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "tool_search" }, { type: "image_generation" }],
    };
    openaiChatStrictToolsSanitize(body, MIMO_TOKEN_PLAN);
    expect(body.tools).toBeUndefined();
  });
});
