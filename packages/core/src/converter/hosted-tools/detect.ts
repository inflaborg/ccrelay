/**
 * Detection helpers for hosted tools on Chat vs Anthropic Messages request bodies.
 */

import { HOSTED_TOOL_MATCHERS } from "./matchers";

import type { HostedToolKind } from "./types";

function matcherForKind(kind: HostedToolKind) {
  return HOSTED_TOOL_MATCHERS.find(m => m.kind === kind);
}

/** Does this Chat Completions body include a hosted tool of `kind` in `tools[]`? */
export function chatBodyHasHostedTool(
  body: Record<string, unknown>,
  kind: HostedToolKind
): boolean {
  const matcher = matcherForKind(kind);
  if (!matcher) {
    return false;
  }
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const typ = (t as Record<string, unknown>).type;
    if (typeof typ === "string" && matcher.matchChatType(typ)) {
      return true;
    }
  }
  return false;
}

/** Does this Anthropic Messages body include a hosted tool of `kind` in `tools[]`? */
export function anthropicBodyHasHostedTool(
  body: Record<string, unknown>,
  kind: HostedToolKind
): boolean {
  const matcher = matcherForKind(kind);
  if (!matcher) {
    return false;
  }
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    if (matcher.matchAnthropicTool(t as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
}

/** All hosted tool kinds present in a Chat body `tools[]` (deduped). */
export function detectChatHostedToolKinds(body: Record<string, unknown>): HostedToolKind[] {
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  const found = new Set<HostedToolKind>();
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const typ = (t as Record<string, unknown>).type;
    if (typeof typ !== "string") {
      continue;
    }
    for (const m of HOSTED_TOOL_MATCHERS) {
      if (m.matchChatType(typ)) {
        found.add(m.kind);
      }
    }
  }
  return [...found];
}
