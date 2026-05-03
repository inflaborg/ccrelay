/**
 * OpenAI Responses API request -> Chat Completions request (wire hub for cross-provider routing)
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { ScopedLogger } from "../utils/logger";
import type {
  OpenAIMessage,
  OpenAIMessageRequest,
  OpenAITool,
  OpenAIToolChoice,
} from "./anthropic-to-openai";
import { assignOpenAiChatMaxOutput } from "./openai/maxOutputTokens";
import { isOpenAIChatCompletionsRequest } from "./openai-to-anthropic-request";

const log = new ScopedLogger("ResponsesToChat");

const STRIPPED_TOOL_TYPES = new Set([
  "web_search",
  "mcp",
  "code_interpreter",
  "file_search",
  "computer",
  "computer_use_preview",
  "image_generation",
  "local_shell",
  "shell",
  "tool_search",
]);

export interface ResponsesToChatResult {
  request: OpenAIMessageRequest;
  newPath: string;
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
  _originalPath: string
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

  const { tools, stripped } = mapResponsesTools(raw.tools);
  if (tools.length) {
    out.tools = tools;
  }
  if (stripped > 0) {
    log.warn(
      `Responses->Chat: stripped ${String(stripped)} non-function tool(s) (web_search, mcp, etc.); not supported in v1`
    );
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

function mapResponsesTools(tools: unknown): { tools: OpenAITool[]; stripped: number } {
  if (!Array.isArray(tools)) {
    return { tools: [], stripped: 0 };
  }
  const out: OpenAITool[] = [];
  let stripped = 0;
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
    } else if (typeof typ === "string" && STRIPPED_TOOL_TYPES.has(typ)) {
      stripped += 1;
    } else if (typ === "namespace" && Array.isArray(o.tools)) {
      for (const inner of o.tools as unknown[]) {
        if (
          inner &&
          typeof inner === "object" &&
          (inner as { type?: string }).type === "function"
        ) {
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
        }
      }
    } else {
      stripped += 1;
    }
  }
  return { tools: out, stripped };
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
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: callId || `call_${name}`,
            type: "function" as const,
            function: { name, arguments: argStr },
          },
        ],
      });
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
