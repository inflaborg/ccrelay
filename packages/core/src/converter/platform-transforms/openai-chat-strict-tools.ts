/**
 * Chat Completions tools sanitize: drop unsupported Responses hosted tools,
 * shim `custom` freeform tools to string-arg `function` entries for Chat-only upstreams,
 * and enforce the OpenAI Chat Completions tools array limit (128).
 */

import { ScopedLogger } from "../../utils/logger";
import { isPlainObject } from "./passthrough";
import { matchHostedToolRuleForBaseUrl, type PlatformMatchOptions } from "./matchRule";

const log = new ScopedLogger("PlatformStrictTools");

/** OpenAI Chat Completions rejects requests with more than this many `tools` entries. */
export const OPENAI_CHAT_MAX_TOOLS = 128;

function formatHint(format: unknown): string | undefined {
  if (!isPlainObject(format)) {
    return undefined;
  }
  const typ = format.type;
  if (typ === "grammar" && typeof format.definition === "string") {
    return `Output format (grammar):\n${format.definition}`;
  }
  if (typeof format.syntax === "string") {
    return `Output format: ${format.syntax}`;
  }
  return undefined;
}

/** Responses `custom` tool → Chat `function` with a single string `input` argument. */
export function customToFunctionShim(tool: Record<string, unknown>): Record<string, unknown> {
  const name = typeof tool.name === "string" ? tool.name : "custom_tool";
  const descParts = [
    typeof tool.description === "string" ? tool.description : undefined,
    formatHint(tool.format),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  return {
    type: "function",
    function: {
      name,
      description: descParts.length > 0 ? descParts.join("\n\n") : undefined,
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Freeform tool input.",
          },
        },
        required: ["input"],
      },
    },
  };
}

function isValidFunctionTool(tool: Record<string, unknown>): boolean {
  if (tool.type !== "function") {
    return false;
  }
  const fn = tool.function;
  if (!isPlainObject(fn)) {
    return false;
  }
  return typeof fn.name === "string" && fn.name.length > 0;
}

function toolDisplayName(tool: Record<string, unknown>): string {
  if (typeof tool.name === "string") {
    return tool.name;
  }
  const fn = tool.function;
  if (isPlainObject(fn) && typeof fn.name === "string") {
    return fn.name;
  }
  return "";
}

function normalizeToolChoiceAfterDrop(
  toolChoice: unknown,
  keptFunctionNames: Set<string>
): unknown {
  if (toolChoice === undefined || toolChoice === null) {
    return toolChoice;
  }
  if (typeof toolChoice === "string") {
    return toolChoice;
  }
  if (!isPlainObject(toolChoice)) {
    return toolChoice;
  }
  const tcType = typeof toolChoice.type === "string" ? toolChoice.type : "";
  const fnBlock = toolChoice.function;
  const fnName =
    (isPlainObject(fnBlock) && typeof fnBlock.name === "string" ? fnBlock.name : undefined) ??
    (typeof toolChoice.name === "string" ? toolChoice.name : undefined);

  if (tcType === "function" && fnName && !keptFunctionNames.has(fnName)) {
    return "auto";
  }
  if (tcType === "custom" && fnName) {
    if (keptFunctionNames.has(fnName)) {
      return { type: "function", function: { name: fnName } };
    }
    return "auto";
  }
  return toolChoice;
}

/**
 * When the matched platform rule sets `strictTools`, filter `tools[]` to Chat-safe entries.
 */
export function openaiChatStrictToolsSanitize(
  body: Record<string, unknown>,
  baseUrl: string,
  options?: PlatformMatchOptions
): void {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  if (!rule?.strictTools) {
    return;
  }

  const rawTools = body.tools;
  if (!Array.isArray(rawTools) || rawTools.length === 0) {
    return;
  }

  const keeplist = new Set<string>(["function", ...Object.keys(rule.tools ?? {})]);
  const kept: Record<string, unknown>[] = [];
  const keptFunctionNames = new Set<string>();

  for (const entry of rawTools) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const tool = entry as Record<string, unknown>;
    const typ = typeof tool.type === "string" ? tool.type : "";

    if (isValidFunctionTool(tool)) {
      kept.push(tool);
      const fnName = (tool.function as Record<string, unknown>).name as string;
      keptFunctionNames.add(fnName);
      continue;
    }

    if (typ === "custom" && typeof tool.name === "string" && tool.name.length > 0) {
      const shimmed = customToFunctionShim(tool);
      kept.push(shimmed);
      keptFunctionNames.add(tool.name);
      continue;
    }

    if (keeplist.has(typ)) {
      kept.push(tool);
      const name = toolDisplayName(tool);
      if (name) {
        keptFunctionNames.add(name);
      }
      continue;
    }

    const name = toolDisplayName(tool) || "(unnamed)";
    log.warn(`[strict-tools] dropped ${rule.provider}: type=${typ || "(missing)"} name=${name}`);
  }

  if (kept.length === 0) {
    delete body.tools;
  } else {
    body.tools = kept;
  }

  if (body.tool_choice !== undefined) {
    body.tool_choice = normalizeToolChoiceAfterDrop(body.tool_choice, keptFunctionNames);
  }
}

/**
 * Truncate `tools[]` to the OpenAI Chat Completions hard limit (default 128).
 * Keeps the first N entries; if `tool_choice` names a dropped function, resets to `"auto"`.
 */
export function capOpenAiChatTools(
  body: Record<string, unknown>,
  max: number = OPENAI_CHAT_MAX_TOOLS
): void {
  const rawTools = body.tools;
  if (!Array.isArray(rawTools) || rawTools.length <= max) {
    return;
  }

  const before = rawTools.length;
  const kept = rawTools.slice(0, max) as Record<string, unknown>[];
  body.tools = kept;
  log.warn(`[tools-limit] truncated tools from ${before} to ${max} (dropped ${before - max})`);

  if (body.tool_choice === undefined) {
    return;
  }

  const keptFunctionNames = new Set<string>();
  for (const entry of kept) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const name = toolDisplayName(entry);
    if (name) {
      keptFunctionNames.add(name);
    }
  }
  body.tool_choice = normalizeToolChoiceAfterDrop(body.tool_choice, keptFunctionNames);
}
