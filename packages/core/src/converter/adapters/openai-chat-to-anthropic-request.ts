/**
 * OpenAI Chat Completions request -> Anthropic Messages request
 * Inverse of anthropic-to-openai convertRequestToOpenAI
 */

/* eslint-disable @typescript-eslint/naming-convention */

import type { MessageParam, ContentBlockParam, AnthropicServerToolDef } from "../../types";
import {
  isOpenAIFunctionTool,
  type AnthropicMessageRequest,
  type AnthropicTool,
  type AnthropicToolChoice,
  type OpenAIMessage,
  type OpenAIMessageRequest,
  type OpenAITool,
} from "./anthropic-to-openai-chat-request";
import { mapOpenAiWirePathToAnthropicUpstream } from "../paths";
import { openAIHostedToolToAnthropicServerToolDef } from "../tool-schema-conversion";
import { resolveModelMeta } from "../model-meta/registry";

export interface OpenAIToAnthropicRequestResult {
  request: AnthropicMessageRequest;
  originalPath: string;
  newPath: string;
}

/**
 * Map OpenAI Chat Completions body to Anthropic Messages body.
 */
export function convertOpenAIRequestToAnthropic(
  openai: OpenAIMessageRequest,
  originalPath: string
): OpenAIToAnthropicRequestResult {
  const messages = openai.messages || [];
  const { systemText, systemBlocks, restMessages } = extractSystem(messages);

  const anthropicMessages = buildAnthropicMessages(restMessages);

  const out: AnthropicMessageRequest = {
    model: openai.model,
    max_tokens: resolveMaxTokens(openai),
    messages: anthropicMessages,
  };

  if (systemText !== undefined) {
    out.system = systemText;
  } else if (systemBlocks && systemBlocks.length > 0) {
    out.system = systemBlocks;
  }

  if (openai.temperature !== undefined) {
    out.temperature = openai.temperature;
  }
  if (openai.top_p !== undefined) {
    out.top_p = openai.top_p;
  }
  if (openai.stream !== undefined) {
    out.stream = openai.stream;
  }
  const hasTools = Boolean(openai.tools && openai.tools.length > 0);
  if (hasTools && openai.tools) {
    out.tools = convertToolsFromOpenAI(openai.tools);
  }
  if (openai.tool_choice !== undefined && hasTools) {
    out.tool_choice = convertToolChoiceFromOpenAI(openai.tool_choice);
  }
  if (openai.stop !== undefined) {
    out.stop_sequences = Array.isArray(openai.stop) ? openai.stop : [openai.stop];
  }
  if (openai.reasoning_effort !== undefined) {
    const rawEffort = openai.reasoning_effort;
    let effortStr: string | undefined;
    if (typeof rawEffort === "string" && rawEffort.trim() !== "") {
      effortStr = rawEffort.toLowerCase();
    } else if (typeof rawEffort === "string") {
      effortStr = "";
    }
    const meta = resolveModelMeta(openai.model, { vendor: "anthropic" });
    if (meta.reasoning.supportsReasoningEffort !== false) {
      if (effortStr === "none" && meta.reasoning.supportsThinking) {
        out.thinking = { type: "disabled" };
      } else if (effortStr !== undefined && meta.reasoning.supportsAdaptiveThinking) {
        out.thinking = { type: "adaptive" };
        if (meta.reasoning.supportsEffort) {
          out.output_config = { effort: mapOpenAIEffortToAnthropic(effortStr) };
        }
      }
    }
  }

  const newPath = mapOpenAiWirePathToAnthropicUpstream(originalPath, "POST");

  return {
    request: out,
    originalPath,
    newPath,
  };
}

function resolveMaxTokens(
  openai: OpenAIMessageRequest & { max_completion_tokens?: number }
): number {
  const o = openai;
  if (typeof o.max_tokens === "number" && o.max_tokens > 0) {
    return o.max_tokens;
  }
  if (typeof o.max_completion_tokens === "number" && o.max_completion_tokens > 0) {
    return o.max_completion_tokens;
  }
  return 4096;
}

/** Map OpenAI `reasoning_effort` to Anthropic `output_config.effort` (adaptive mode). */
function mapOpenAIEffortToAnthropic(effort?: string): string {
  if (!effort) {
    return "high";
  }
  const e = effort.toLowerCase();
  if (e === "minimal") {
    return "low";
  }
  return e;
}

function stringifyToolContent(rawContent: OpenAIMessage["content"]): string {
  if (typeof rawContent === "string") {
    return rawContent;
  }
  return JSON.stringify(rawContent ?? "");
}

function extractSystem(messages: OpenAIMessage[]): {
  systemText?: string;
  systemBlocks?: Array<{
    type: "text";
    text: string;
    cache_control?: { type: string; ttl?: string };
  }>;
  restMessages: OpenAIMessage[];
} {
  const rest: OpenAIMessage[] = [];
  const systemParts: string[] = [];
  const systemBlockParts: Array<{ type: "text"; text: string }> = [];

  for (const m of messages) {
    if (m.role !== "system" && m.role !== "developer") {
      rest.push(m);
      continue;
    }
    if (typeof m.content === "string") {
      systemParts.push(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text" && "text" in part) {
          systemBlockParts.push({ type: "text", text: part.text });
        }
      }
    }
  }

  if (systemBlockParts.length > 0) {
    const mergedBlocks = [
      ...systemParts.map(text => ({ type: "text" as const, text })),
      ...systemBlockParts,
    ];
    return {
      systemBlocks: mergedBlocks,
      restMessages: rest,
    };
  }
  if (systemParts.length > 0) {
    return {
      systemText: systemParts.join("\n\n"),
      restMessages: rest,
    };
  }
  return { restMessages: rest };
}

function buildAnthropicMessages(messages: OpenAIMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  let i = 0;
  let lastAssistantHadToolCalls = false;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === "user") {
      out.push({ role: "user", content: convertUserContent(m) });
      i++;
      lastAssistantHadToolCalls = false;
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: convertAssistantContent(m) });
      lastAssistantHadToolCalls = Boolean(m.tool_calls && m.tool_calls.length > 0);
      i++;
      const toolResults: ContentBlockParam[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i];
        const text = stringifyToolContent(t.content);
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.tool_call_id || "",
          content: text,
        });
        i++;
      }
      if (toolResults.length > 0) {
        out.push({ role: "user", content: toolResults });
      }
    } else if (m.role === "tool") {
      // Skip orphaned tool messages (no preceding assistant message with tool_calls)
      if (!lastAssistantHadToolCalls) {
        i++;
        continue;
      }
      const toolResults: ContentBlockParam[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i];
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.tool_call_id || "",
          content: stringifyToolContent(t.content),
        });
        i++;
      }
      if (toolResults.length > 0) {
        out.push({ role: "user", content: toolResults });
      }
    } else {
      i++;
    }
  }
  return out;
}

function convertUserContent(m: OpenAIMessage): string | ContentBlockParam[] {
  const c = m.content;
  if (typeof c === "string") {
    return c;
  }
  if (!Array.isArray(c)) {
    return "";
  }
  const blocks: ContentBlockParam[] = [];
  for (const part of c) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const url = part.image_url?.url || "";
      const parsed = parseDataUrl(url);
      if (parsed) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mediaType,
            data: parsed.data,
          },
        });
      } else {
        blocks.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : "";
}

function convertAssistantContent(m: OpenAIMessage): string | ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  if (m.thinking?.content) {
    blocks.push({
      type: "thinking",
      thinking: m.thinking.content,
      signature: m.thinking.signature,
    });
  } else if (typeof m.reasoning_content === "string" && m.reasoning_content.length > 0) {
    blocks.push({
      type: "thinking",
      thinking: m.reasoning_content,
    });
  }
  if (typeof m.content === "string" && m.content.length > 0) {
    blocks.push({ type: "text", text: m.content });
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text });
      }
    }
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    for (const tc of m.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        input = { raw: tc.function.arguments };
      }
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }
  if (blocks.length === 0) {
    return "";
  }
  return blocks.length === 1 && blocks[0].type === "text" && !m.tool_calls?.length
    ? (blocks[0] as { type: "text"; text: string }).text
    : blocks;
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!m) {
    return null;
  }
  return { mediaType: m[1], data: m[2] };
}

function convertToolsFromOpenAI(tools: OpenAITool[]): (AnthropicTool | AnthropicServerToolDef)[] {
  const out: (AnthropicTool | AnthropicServerToolDef)[] = [];
  for (const t of tools) {
    if (isOpenAIFunctionTool(t)) {
      out.push({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object", properties: {} },
      });
    } else {
      out.push(openAIHostedToolToAnthropicServerToolDef(t));
    }
  }
  return out;
}

function convertToolChoiceFromOpenAI(
  choice: OpenAIMessageRequest["tool_choice"]
): AnthropicToolChoice {
  if (choice === "auto") {
    return { type: "auto" };
  }
  if (choice === "none") {
    return { type: "none" };
  }
  if (choice === "required") {
    return { type: "any" };
  }
  if (typeof choice === "object" && choice !== null) {
    const o = choice as { type: string; function?: { name: string } };
    if (o.type === "function" && o.function?.name) {
      return { type: "tool", name: o.function.name };
    }
  }
  return { type: "auto" };
}

/**
 * Heuristic: body has a messages array (caller should only use on OpenAI surface paths)
 */
export function isOpenAIChatCompletionsRequest(data: Record<string, unknown>): boolean {
  return Array.isArray(data.messages);
}
