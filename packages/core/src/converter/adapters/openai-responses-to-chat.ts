/**
 * Echo helpers and OpenAI Responses API request -> Chat Completions request (wire hub).
 */

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Responses API wire names */

import type { ResponsesRequestEcho } from "../../types";
import type {
  OpenAIMessage,
  OpenAIMessageRequest,
  OpenAITool,
  OpenAIToolChoice,
} from "./anthropic-to-openai-chat-request";
import { assignOpenAiChatMaxOutput } from "../rules/openai-chat-model-rules";
import { isOpenAIChatCompletionsRequest } from "./openai-chat-to-anthropic-request";

/** Collect tools for Responses echo: `function` defs, nested `namespace` bundles (inner tools), and hosted tools (web_search, etc.). */
export function extractFunctionToolsForEcho(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const out: unknown[] = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const o = t as Record<string, unknown>;
    if (o.type === "function") {
      out.push(t);
      continue;
    }
    if (o.type === "namespace" && Array.isArray(o.tools)) {
      for (const inner of o.tools as unknown[]) {
        if (
          inner &&
          typeof inner === "object" &&
          typeof (inner as { type?: string }).type === "string"
        ) {
          out.push(inner);
        }
      }
      continue;
    }
    if (typeof o.type === "string") {
      out.push(t);
    }
  }
  return out;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

/**
 * Pull echo fields from parsed OpenAI Responses request JSON (`raw`).
 */
export function extractResponsesEcho(raw: Record<string, unknown>): ResponsesRequestEcho {
  const tools = extractFunctionToolsForEcho(raw.tools);
  const parallel =
    typeof raw.parallel_tool_calls === "boolean" ? raw.parallel_tool_calls : undefined;
  const store = typeof raw.store === "boolean" ? raw.store : undefined;
  const truncation = typeof raw.truncation === "string" ? raw.truncation : undefined;
  const previous =
    typeof raw.previous_response_id === "string"
      ? raw.previous_response_id
      : raw.previous_response_id === null
        ? null
        : undefined;
  const user = typeof raw.user === "string" ? raw.user : raw.user === null ? null : undefined;
  const instructions =
    typeof raw.instructions === "string"
      ? raw.instructions
      : raw.instructions === null
        ? null
        : undefined;

  let reasoning: ResponsesRequestEcho["reasoning"];
  const rRaw = raw.reasoning;
  const rec = asRecord(rRaw);
  if (rec) {
    reasoning = {
      effort: rec.effort as string | null | undefined,
      summary: rec.summary as string | null | undefined,
    };
  }

  let textFmt: ResponsesRequestEcho["text"];
  const txt = raw.text;
  const textRec = asRecord(txt);
  if (textRec) {
    textFmt = { format: textRec.format };
  }

  let meta: ResponsesRequestEcho["metadata"];
  const m = raw.metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    meta = { ...(m as Record<string, unknown>) };
  }

  let tool_choice: unknown;
  if (raw.tool_choice !== undefined) {
    tool_choice = raw.tool_choice;
  }

  const echo: ResponsesRequestEcho = {
    tools,
    ...(tool_choice !== undefined ? { tool_choice } : {}),
    ...(parallel !== undefined ? { parallel_tool_calls: parallel } : {}),
    ...(store !== undefined ? { store } : {}),
    ...(truncation !== undefined ? { truncation } : {}),
    ...(previous !== undefined ? { previous_response_id: previous } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(textFmt ? { text: textFmt } : {}),
    ...(meta !== undefined ? { metadata: meta } : {}),
  };
  return echo;
}

/**
 * Merge echo into `response.created` / `response.in_progress` / `response.completed` shells (defaults when absent).
 */
export function mergedResponseShellEcho(echo?: ResponsesRequestEcho): Record<string, unknown> {
  return {
    parallel_tool_calls: echo?.parallel_tool_calls ?? true,
    previous_response_id:
      echo?.previous_response_id !== undefined ? echo.previous_response_id : null,
    reasoning: echo?.reasoning ?? { effort: null, summary: null },
    store: echo?.store ?? true,
    text: echo?.text ?? { format: { type: "text" } },
    tool_choice: echo?.tool_choice !== undefined ? echo.tool_choice : "auto",
    tools: echo?.tools ?? [],
    truncation: echo?.truncation ?? "disabled",
    user: echo?.user !== undefined ? echo.user : null,
    metadata: echo?.metadata !== undefined ? { ...echo.metadata } : {},
    instructions: echo?.instructions !== undefined ? echo.instructions : null,
  };
}

export interface ResponsesToChatResult {
  request: OpenAIMessageRequest;
  newPath: string;
}

export interface ResponsesToChatOptions {
  /** Kept for callers; hosted-tool shaping runs in `BodyProcessor` via `normalizeToolsForProvider`. */
  providerBaseUrl?: string;
}

/**
 * True if body looks like a Responses "create" request (not Chat Completions `messages`).
 */
export function isOpenAIResponsesRequest(data: Record<string, unknown>): boolean {
  if (isOpenAIChatCompletionsRequest(data)) {
    return false;
  }
  return (
    typeof data.input === "string" ||
    Array.isArray(data.input) ||
    (data.instructions !== undefined && !Array.isArray(data.messages))
  );
}

/**
 * Map POST /v1/responses body to Chat Completions body; target path from provider (default /chat/completions).
 */
export function convertResponsesRequestToChatCompletions(
  raw: Record<string, unknown>,
  _originalPath: string,
  _options?: ResponsesToChatOptions
): ResponsesToChatResult {
  const messages: OpenAIMessage[] = [];
  const instructions = raw.instructions;
  if (typeof instructions === "string" && instructions.trim() !== "") {
    messages.push({ role: "system", content: instructions });
  } else if (Array.isArray(instructions)) {
    for (const item of instructions) {
      if (item && typeof item === "object" && "type" in item) {
        const t = (item as { type?: string }).type;
        if (t === "message" && "content" in item) {
          const role = (item as { role?: string }).role;
          const content = mapEasyMessageContentToText((item as { content?: unknown }).content);
          if (content !== undefined && (role === "system" || role === "developer")) {
            messages.push({ role: "system", content });
          }
        }
      }
    }
  }

  const input = raw.input;
  if (typeof input === "string") {
    if (input.length > 0) {
      messages.push({ role: "user", content: input });
    }
  } else if (Array.isArray(input)) {
    appendInputItemsToMessages(input, messages);
  }

  if (messages.length === 0 && typeof raw.model === "string") {
    messages.push({ role: "user", content: "" });
  }

  const model = typeof raw.model === "string" ? raw.model : "";
  const out: OpenAIMessageRequest = {
    model,
    messages,
  };

  if (typeof raw.temperature === "number") {
    out.temperature = raw.temperature;
  }
  if (typeof raw.top_p === "number") {
    out.top_p = raw.top_p;
  }
  if (typeof raw.stream === "boolean") {
    out.stream = raw.stream;
  }
  if (typeof raw.max_output_tokens === "number") {
    assignOpenAiChatMaxOutput(out, raw.max_output_tokens);
  } else if (typeof raw.max_tokens === "number") {
    assignOpenAiChatMaxOutput(out, raw.max_tokens);
  }

  const reasoning = raw.reasoning;
  if (reasoning && typeof reasoning === "object") {
    const r = reasoning as { effort?: string; summary?: string };
    out.reasoning = {
      effort: r.effort,
      enabled: r.effort !== "none",
    };
  }

  const tools = mapResponsesTools(raw.tools);
  if (tools.length) {
    out.tools = tools;
  }
  const mappedChoice = mapResponsesToolChoice(raw.tool_choice);
  if (mappedChoice !== undefined) {
    out.tool_choice = mappedChoice;
  }

  return {
    request: out,
    newPath: "/chat/completions",
  };
}

function mapResponsesToolChoice(tc: unknown): OpenAIToolChoice | undefined {
  if (tc === undefined || tc === null) {
    return undefined;
  }
  if (tc === "none" || tc === "auto") {
    return tc;
  }
  if (tc === "required") {
    return "required";
  }
  if (typeof tc === "object" && tc !== null && "type" in tc) {
    const t = (tc as { type?: string; name?: string; function?: { name?: string } }).type;
    if (t === "function") {
      const n =
        (tc as { function?: { name?: string } }).function?.name ?? (tc as { name?: string }).name;
      if (n) {
        return { type: "function", function: { name: n } };
      }
    }
  }
  return undefined;
}

function mapResponsesTools(tools: unknown): OpenAITool[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const out: OpenAITool[] = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const o = t as Record<string, unknown>;
    const typ = o.type;
    if (typ === "function") {
      const fnName = typeof o.name === "string" ? o.name : "";
      out.push({
        type: "function",
        function: {
          name: fnName,
          description: typeof o.description === "string" ? o.description : undefined,
          parameters: (o.parameters as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        },
      });
    } else if (typ === "namespace" && Array.isArray(o.tools)) {
      for (const inner of o.tools as unknown[]) {
        if (!inner || typeof inner !== "object") {
          continue;
        }
        const inn = inner as Record<string, unknown>;
        const it = inn.type;
        if (it === "function") {
          const f = inner as { name?: string; description?: string; parameters?: unknown };
          out.push({
            type: "function",
            function: {
              name: String(f.name ?? ""),
              description: typeof f.description === "string" ? f.description : undefined,
              parameters: (f.parameters as Record<string, unknown>) ?? {
                type: "object",
                properties: {},
              },
            },
          });
        } else if (typeof it === "string") {
          out.push(inn as OpenAITool);
        }
      }
    } else if (typeof typ === "string") {
      out.push(o as OpenAITool);
    }
  }
  return out;
}

function mapEasyMessageContentToText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as { type?: string; text?: string };
    if (b.type === "input_text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  if (parts.length) {
    return parts.join("\n");
  }
  return undefined;
}

/**
 * Map Responses `input` array into Chat `messages` (subset of item types).
 */
function appendInputItemsToMessages(items: unknown[], messages: OpenAIMessage[]): void {
  for (const item of items) {
    if (item === null || item === undefined) {
      continue;
    }
    if (typeof item === "string") {
      if (item.length) {
        messages.push({ role: "user", content: item });
      }
      continue;
    }
    if (typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const typ = o.type;

    if (typ === "message" || o.role !== undefined) {
      const role = o.role;
      const r = typeof role === "string" ? role : "user";
      if (r === "user" || r === "system" || r === "developer" || r === "assistant") {
        const text =
          mapEasyMessageContentToText(o.content) ??
          (typeof o.content === "string" ? o.content : "");
        const oaiRole: OpenAIMessage["role"] =
          r === "developer"
            ? "developer"
            : r === "system"
              ? "system"
              : r === "assistant"
                ? "assistant"
                : "user";
        if (oaiRole === "assistant" && !text && !Array.isArray(o.content)) {
          continue;
        }
        messages.push({ role: oaiRole, content: text });
      }
      continue;
    }

    if (typ === "function_call") {
      const name = String((o as { name?: string }).name ?? "");
      const argStr =
        typeof o.arguments === "string" ? o.arguments : JSON.stringify(o.arguments ?? {});
      const rawId = o as { call_id?: unknown; id?: unknown };
      const callId =
        typeof rawId.call_id === "string"
          ? rawId.call_id
          : typeof rawId.id === "string"
            ? rawId.id
            : "";
      const toolCall = {
        id: callId || `call_${name}`,
        type: "function" as const,
        function: { name, arguments: argStr },
      };
      const prev = messages[messages.length - 1];
      if (prev?.role === "assistant" && Array.isArray(prev.tool_calls)) {
        prev.tool_calls.push(toolCall);
      } else {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [toolCall],
        });
      }
      continue;
    }

    if (typ === "function_call_output") {
      const callId = String((o as { call_id?: string }).call_id ?? "");
      let out: string;
      if (typeof o.output === "string") {
        out = o.output;
      } else {
        out = JSON.stringify(o.output ?? "");
      }
      messages.push({
        role: "tool",
        content: out,
        tool_call_id: callId,
      });
      continue;
    }

    if (typ === "reasoning" && o.summary !== undefined) {
      // skip serializing full reasoning; optional user-visible summary only in follow-ups
    }
  }
}
