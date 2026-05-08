/**
 * Field-level mappings for hosted/server tools across Anthropic Messages and OpenAI Chat/Responses wire.
 *
 * Naming: object keys mirror external API `tool.type` literals (Anthropic/OpenAI).
 */
/* eslint-disable @typescript-eslint/naming-convention -- wire tool strings (`web_search`, `code_execution`, …) */

import type { AnthropicServerToolDef } from "../types";
import { normalizeToolForProvider } from "./hosted-tools";

export {
  normalizeToolForProvider,
  normalizeToolsForProvider,
  normalizedHostnameFromBaseUrl,
  hostnameMatchesDomain,
  matchHostedToolRuleForBaseUrl,
} from "./hosted-tools";

export type { NormalizeToolsResult } from "./hosted-tools";

/** Anthropic `{type}_${YYYYMMDD}` suffix (API version stamp, not a request timestamp). */
const ANTHROPIC_TOOL_VERSION_SUFFIX = /^(.+)_(\d{8})$/;

/** After stripping `_YYYYMMDD`, map Anthropic logical tool id → Chat/OpenAI-hosted `type` string. */
const ANTHROPIC_BASE_TO_CHAT_HOSTED_TYPE: Record<string, string> = {
  code_execution: "code_interpreter",
};

/**
 * Latest known Anthropic API version stamps per logical Chat hosted tool type.
 * Bump when upstream adds a new tool revision.
 */
export const CHAT_HOSTED_TOOL_TO_ANTHROPIC: Record<string, { type: string; name: string }> = {
  web_search: { type: "web_search_20250305", name: "web_search" },
  text_editor: { type: "text_editor_20250124", name: "text_editor" },
  code_interpreter: { type: "code_execution_20250522", name: "code_execution" },
};

/** Strip `_YYYYMMDD` from Anthropic server tool `type` when present; otherwise return unchanged. */
export function stripAnthropicToolVersionSuffix(anthropicType: string): string {
  const m = ANTHROPIC_TOOL_VERSION_SUFFIX.exec(anthropicType);
  return m?.[1] ?? anthropicType;
}

/** Map stripped Anthropic tool base → OpenAI Chat/Responses hosted `type` (e.g. code_execution → code_interpreter). */
export function anthropicToolBaseToChatHostedType(base: string): string {
  return ANTHROPIC_BASE_TO_CHAT_HOSTED_TYPE[base] ?? base;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Build `{ type: <chat-hosted>, ... }` from Anthropic server tool definition.
 *
 * `providerBaseUrl`: upstream hostname drives hosted-tool outbound transforms (`hosted-tools/rules.ts`).
 */
export function anthropicServerToolDefToOpenAIHosted(
  tool: AnthropicServerToolDef,
  providerBaseUrl?: string
): Record<string, unknown> {
  const shallow: Record<string, unknown> = { ...tool };
  const anthropicTypeUnknown = shallow.type;
  delete shallow.type;
  delete shallow.name;
  const anthropicType = typeof anthropicTypeUnknown === "string" ? anthropicTypeUnknown : "";
  const base = stripAnthropicToolVersionSuffix(anthropicType);
  const hostedType = anthropicToolBaseToChatHostedType(base);
  const raw = { ...shallow, type: hostedType };
  return normalizeToolForProvider(raw, providerBaseUrl ?? "");
}

/** Map Chat-hosted `type` + extra fields → Anthropic `AnthropicServerToolDef`. */
export function openAIHostedToolToAnthropicServerToolDef(
  tool: Record<string, unknown>
): AnthropicServerToolDef {
  const typ = typeof tool.type === "string" ? tool.type : "";
  const mapped = typ ? CHAT_HOSTED_TOOL_TO_ANTHROPIC[typ] : undefined;
  const rest: Record<string, unknown> = { ...tool };
  delete rest.type;
  delete rest.name;

  if (typ === "web_search") {
    const envelope = tool.web_search;
    if (isPlainObject(envelope)) {
      delete rest.web_search;
      const mu = envelope.max_uses;
      if (typeof mu === "number" && (rest.max_uses === undefined || rest.max_uses === null)) {
        rest.max_uses = mu;
      }
    }
  }

  if (mapped) {
    return { type: mapped.type, name: mapped.name, ...rest };
  }
  const fallbackName = typ || "unknown_tool";
  return { type: typ, name: fallbackName, ...rest };
}
