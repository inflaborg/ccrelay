/**
 * Normalize OpenAI Chat `tool_calls[].function.arguments` strings for upstream providers
 * that JSON-parse arguments during prefill (e.g. MiMo).
 */

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("ToolCallArguments");

/**
 * Coerce a tool-call arguments string into parseable JSON object text.
 * Truncated or non-JSON payloads are wrapped as `{ "raw": "..." }`.
 */
export function normalizeOpenAiToolCallArgumentsString(args: string): string {
  const trimmed = typeof args === "string" ? args.trim() : "";
  if (trimmed.length === 0) {
    return "{}";
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return trimmed;
    }
    return JSON.stringify({ value: parsed });
  } catch {
    return JSON.stringify({ raw: args });
  }
}

/** Repair malformed `tool_calls[].function.arguments` on assistant messages in place. */
export function sanitizeOpenAiChatToolArgumentsInMessages(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 0;
  }
  let repairedCount = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const m = msg as OpenAIMessage;
    if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) {
      continue;
    }
    for (const tc of m.tool_calls) {
      const fn = tc?.function;
      if (!fn || typeof fn.arguments !== "string") {
        continue;
      }
      const normalized = normalizeOpenAiToolCallArgumentsString(fn.arguments);
      if (normalized !== fn.arguments) {
        log.warn(
          `[tool-args] repaired malformed arguments for ${fn.name || "(unnamed)"} ` +
            `(len=${fn.arguments.length}, preview=${JSON.stringify(fn.arguments.slice(0, 48))})`
        );
        fn.arguments = normalized;
        repairedCount++;
      }
    }
  }
  return repairedCount;
}
