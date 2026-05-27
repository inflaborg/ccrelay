/**
 * Chat Completions strict tools sanitize: drop unsupported Responses hosted tools and
 * shim `custom` freeform tools to string-arg `function` entries for Chat-only upstreams.
 */

import { ScopedLogger } from "../../utils/logger";
import { normalizedHostnameFromBaseUrl } from "./hostname";
import { isPlainObject } from "./passthrough";
import { ruleHostnameMatches } from "./ruleHostname";
import { PLATFORM_TRANSFORM_RULES, type HostedToolRule } from "./rules";

function matchRuleForBaseUrl(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

const log = new ScopedLogger("PlatformStrictTools");

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
  baseUrl: string
): void {
  const rule = matchRuleForBaseUrl(baseUrl);
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
