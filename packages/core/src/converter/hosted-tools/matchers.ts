/**
 * Declarative matchers per HostedToolKind — single source of truth for detection rules.
 */

import { stripAnthropicToolVersionSuffix } from "../tool-schema-conversion";

import type { HostedToolMatcher } from "./types";

function anthropicWebSearchTool(tool: Record<string, unknown>): boolean {
  const typ = typeof tool.type === "string" ? tool.type : "";
  const name = typeof tool.name === "string" ? tool.name : "";
  if (name === "web_search") {
    return true;
  }
  if (typ.startsWith("web_search_")) {
    return true;
  }
  if (stripAnthropicToolVersionSuffix(typ) === "web_search") {
    return true;
  }
  if (name.includes("web_search")) {
    return true;
  }
  return false;
}

function anthropicCodeInterpreterTool(tool: Record<string, unknown>): boolean {
  const typ = typeof tool.type === "string" ? tool.type : "";
  return stripAnthropicToolVersionSuffix(typ) === "code_execution";
}

function anthropicTextEditorTool(tool: Record<string, unknown>): boolean {
  const typ = typeof tool.type === "string" ? tool.type : "";
  return stripAnthropicToolVersionSuffix(typ) === "text_editor";
}

export const HOSTED_TOOL_MATCHERS: readonly HostedToolMatcher[] = [
  {
    kind: "web_search",
    matchChatType: typ => typ === "web_search" || typ.startsWith("web_search"),
    matchAnthropicTool: anthropicWebSearchTool,
  },
  {
    kind: "code_interpreter",
    matchChatType: typ => typ === "code_interpreter",
    matchAnthropicTool: anthropicCodeInterpreterTool,
  },
  {
    kind: "text_editor",
    matchChatType: typ => typ === "text_editor",
    matchAnthropicTool: anthropicTextEditorTool,
  },
];
