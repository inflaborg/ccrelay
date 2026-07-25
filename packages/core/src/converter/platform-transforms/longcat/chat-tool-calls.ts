/**
 * LongCat Chat Completions: convert embedded `<longcat_tool_call>` XML in assistant
 * content into OpenAI `message.tool_calls` (Meituan LongCat wire format).
 *
 * Format:
 * ```
 * <longcat_tool_call>{function-name}
 * <longcat_arg_key>{key}</longcat_arg_key>
 * <longcat_arg_value>{value}</longcat_arg_value>
 * ...
 * </longcat_tool_call>
 * ```
 */

import { randomUUID } from "crypto";

const TOOL_CALL_BLOCK_RE = /<longcat_tool_call>([\s\S]*?)<\/longcat_tool_call>/g;
const ARG_PAIR_RE =
  /<longcat_arg_key>([\s\S]*?)<\/longcat_arg_key>\s*<longcat_arg_value>([\s\S]*?)<\/longcat_arg_value>/g;

export interface LongcatParsedToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LongcatToolCallExtractResult {
  /** Assistant-visible text with tool-call XML removed. */
  content: string;
  toolCalls: LongcatParsedToolCall[];
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    const o = asRecord(block);
    if (!o) {
      continue;
    }
    if (typeof o.text === "string") {
      parts.push(o.text);
    }
  }
  return parts.join("");
}

/** Parse a single arg value: JSON when possible, otherwise raw string. */
export function parseLongcatArgValue(raw: string): unknown {
  const s = raw.trim();
  if (s.length === 0) {
    return "";
  }
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
}

function newToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Extract LongCat XML tool calls from assistant text.
 * Returns original text unchanged when no complete tool-call blocks are found.
 */
export function extractLongcatToolCalls(text: string): LongcatToolCallExtractResult {
  if (!text.includes("<longcat_tool_call>")) {
    return { content: text, toolCalls: [] };
  }

  const toolCalls: LongcatParsedToolCall[] = [];
  let match: RegExpExecArray | null;
  TOOL_CALL_BLOCK_RE.lastIndex = 0;
  while ((match = TOOL_CALL_BLOCK_RE.exec(text)) !== null) {
    const body = match[1] ?? "";
    const nameMatch = body.trim().match(/^([^\n<]+)/);
    const name = nameMatch?.[1]?.trim() ?? "";
    if (!name) {
      continue;
    }

    const args: Record<string, unknown> = {};
    ARG_PAIR_RE.lastIndex = 0;
    let pair: RegExpExecArray | null;
    while ((pair = ARG_PAIR_RE.exec(body)) !== null) {
      const key = (pair[1] ?? "").trim();
      if (!key) {
        continue;
      }
      args[key] = parseLongcatArgValue(pair[2] ?? "");
    }

    toolCalls.push({
      id: newToolCallId(),
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
  }

  if (toolCalls.length === 0) {
    return { content: text, toolCalls: [] };
  }

  const content = text
    .replace(TOOL_CALL_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content, toolCalls };
}

/**
 * Mutate an OpenAI Chat Completions response body in place: lift LongCat XML
 * tool calls out of `choices[].message.content` into `tool_calls`.
 */
export function sanitizeLongcatChatCompletion(body: Record<string, unknown>): void {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return;
  }

  for (const choice of choices) {
    const c = asRecord(choice);
    if (!c) {
      continue;
    }
    const message = asRecord(c.message);
    if (!message) {
      continue;
    }

    const text = messageContentToString(message.content);
    if (!text.includes("<longcat_tool_call>")) {
      continue;
    }

    const { content, toolCalls } = extractLongcatToolCalls(text);
    if (toolCalls.length === 0) {
      continue;
    }

    message.content = content.length > 0 ? content : null;

    const existing = Array.isArray(message.tool_calls)
      ? (message.tool_calls as LongcatParsedToolCall[])
      : [];
    message.tool_calls = [...existing, ...toolCalls];

    const fr = c.finish_reason;
    if (fr === "stop" || fr === null || fr === undefined || fr === "") {
      c.finish_reason = "tool_calls";
    }
  }
}
