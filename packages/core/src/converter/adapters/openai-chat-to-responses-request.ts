/**
 * OpenAI Chat Completions request JSON → OpenAI Responses API request JSON (POST /responses).
 * Provider-specific upstream tool shaping belongs in platform-transforms, not here.
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire API keys */

import type {
  OpenAIMessage,
  OpenAIMessageRequest,
  OpenAITool,
  OpenAIToolChoice,
} from "./anthropic-to-openai-chat-request";
import {
  isOpenAIFunctionTool,
  isOpenAIFunctionToolChoice,
} from "./anthropic-to-openai-chat-request";
import { resolveModelMeta } from "../model-meta/registry";
import {
  normalizeOpenAiChatReasoningEffort,
  openAiChatRequestHasFunctionTools,
} from "../model-meta/sanitize-openai-chat";
import { hostedChatTypeForToolChoiceName } from "../tool-schema-conversion";

export interface ChatToResponsesRequestResult {
  /** POST body for `/responses` */
  request: Record<string, unknown>;
  newPath: string;
}

function messageTextContent(msg: OpenAIMessage): string {
  const c = msg.content;
  if (typeof c === "string") {
    return c;
  }
  if (!Array.isArray(c)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of c) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  return parts.join("\n");
}

function imageUrlFromChatPart(block: {
  type?: string;
  image_url?: string | { url?: string; detail?: string };
}): { url: string; detail?: string } | undefined {
  if (block.type !== "image_url") {
    return undefined;
  }
  if (typeof block.image_url === "string" && block.image_url.length > 0) {
    return { url: block.image_url };
  }
  if (
    block.image_url &&
    typeof block.image_url === "object" &&
    typeof block.image_url.url === "string" &&
    block.image_url.url.length > 0
  ) {
    const detail =
      typeof block.image_url.detail === "string" && block.image_url.detail.length > 0
        ? block.image_url.detail
        : undefined;
    return { url: block.image_url.url, ...(detail ? { detail } : {}) };
  }
  return undefined;
}

/** User Chat content → Responses `input_text` / `input_image` parts. */
function userMessageToResponsesContent(msg: OpenAIMessage): unknown[] {
  const c = msg.content;
  if (typeof c === "string") {
    return c.length > 0 ? [{ type: "input_text", text: c }] : [];
  }
  if (!Array.isArray(c)) {
    return [];
  }
  const parts: unknown[] = [];
  for (const block of c) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as {
      type?: string;
      text?: string;
      image_url?: string | { url?: string; detail?: string };
    };
    if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
      parts.push({ type: "input_text", text: b.text });
      continue;
    }
    const image = imageUrlFromChatPart(b);
    if (image) {
      parts.push({
        type: "input_image",
        image_url: image.url,
        ...(image.detail ? { detail: image.detail } : {}),
      });
    }
  }
  return parts;
}

function chatMessagesToResponsesInput(messages: OpenAIMessage[]): {
  instructions?: string;
  input: unknown[];
} {
  const instructionParts: string[] = [];
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const t = messageTextContent(msg);
      if (t.length > 0) {
        instructionParts.push(t);
      }
      continue;
    }

    if (msg.role === "user") {
      const content = userMessageToResponsesContent(msg);
      if (content.length > 0) {
        input.push({
          type: "message",
          role: "user",
          content,
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const text = messageTextContent(msg);
      const reasoningText =
        typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0
          ? msg.reasoning_content
          : typeof msg.thinking?.content === "string" && msg.thinking.content.length > 0
            ? msg.thinking.content
            : undefined;
      if (reasoningText) {
        input.push({
          type: "reasoning",
          summary: [{ type: "summary_text", text: reasoningText }],
        });
      }
      const toolCalls = msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          // Responses item `id` must be `fc_*`; Chat uses `call_*`. Pairing is `call_id`.
          input.push({
            type: "function_call",
            name: tc.function.name,
            arguments: tc.function.arguments,
            call_id: tc.id,
          });
        }
      }
      if (text.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      continue;
    }

    if (msg.role === "tool") {
      const callId = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
      const out = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: out,
      });
    }
  }

  const instructions = instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined;
  return { instructions, input };
}

function mapChatToolToResponsesTool(tool: OpenAITool): Record<string, unknown> {
  if (isOpenAIFunctionTool(tool)) {
    const fn = tool.function as {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    };
    const out: Record<string, unknown> = {
      type: "function",
      name: fn.name,
      parameters: fn.parameters ?? { type: "object", properties: {} },
    };
    if (typeof fn.description === "string" && fn.description.length > 0) {
      out.description = fn.description;
    }
    if (typeof fn.strict === "boolean") {
      out.strict = fn.strict;
    }
    return out;
  }
  const { type, ...rest } = tool as Record<string, unknown>;
  return { type, ...rest };
}

function mapChatToolChoiceToResponses(
  tc: OpenAIToolChoice | undefined,
  tools: OpenAITool[] | undefined
): unknown {
  if (tc === undefined) {
    return undefined;
  }
  if (tc === "auto" || tc === "none" || tc === "required") {
    return tc;
  }
  if (isOpenAIFunctionToolChoice(tc)) {
    const hostedType = hostedChatTypeForToolChoiceName(tc.function.name, tools);
    if (hostedType) {
      return { type: hostedType };
    }
    return {
      type: "function",
      name: tc.function.name,
    };
  }
  if (typeof tc === "object" && typeof tc.type === "string" && tc.type.length > 0) {
    return { type: tc.type };
  }
  return tc;
}

/**
 * Convert a parsed Chat Completions request object into a Responses `POST /v1/responses` body.
 * Forces `stream: false` for cross-protocol conversion.
 */
export function convertOpenAIMessageRequestToResponsesRequest(
  chat: OpenAIMessageRequest
): ChatToResponsesRequestResult {
  const { instructions, input } = chatMessagesToResponsesInput(chat.messages ?? []);

  const out: Record<string, unknown> = {
    model: chat.model,
    input: input.length > 0 ? input : "",
    stream: false,
  };

  if (instructions !== undefined && instructions.length > 0) {
    out.instructions = instructions;
  }

  if (typeof chat.temperature === "number") {
    out.temperature = chat.temperature;
  }
  if (typeof chat.top_p === "number") {
    out.top_p = chat.top_p;
  }

  const maxBudget =
    typeof chat.max_completion_tokens === "number"
      ? chat.max_completion_tokens
      : typeof chat.max_tokens === "number"
        ? chat.max_tokens
        : undefined;
  if (maxBudget !== undefined) {
    out.max_output_tokens = maxBudget;
  }

  if (chat.tools && chat.tools.length > 0) {
    out.tools = chat.tools.map(t => mapChatToolToResponsesTool(t));
  }
  const mappedChoice = mapChatToolChoiceToResponses(chat.tool_choice, chat.tools);
  if (mappedChoice !== undefined) {
    out.tool_choice = mappedChoice;
  }

  if (typeof chat.parallel_tool_calls === "boolean") {
    out.parallel_tool_calls = chat.parallel_tool_calls;
  }

  if (typeof chat.reasoning_effort === "string" && chat.reasoning_effort.trim() !== "") {
    const meta = resolveModelMeta(chat.model, { vendor: "openai" });
    const effort = normalizeOpenAiChatReasoningEffort(chat.reasoning_effort, meta);
    if (effort !== undefined) {
      out.reasoning = { effort };
    }
  }

  return {
    request: out,
    newPath: "/responses",
  };
}

/**
 * When the upstream speaks Responses, send function-tool or hosted-tool Chat bodies
 * (gpt-5.4+ / gpt-6, and any hosted web_search) to POST `/responses`.
 */
export function maybeUpgradeChatFunctionToolsToResponses(
  chatBody: Record<string, unknown>
): { body: Record<string, unknown>; path: string; responseFormat: "responses" } | null {
  const model = typeof chatBody.model === "string" ? chatBody.model : "";
  const meta = resolveModelMeta(model, { vendor: "openai" });
  const hasFunctionTools = openAiChatRequestHasFunctionTools(chatBody);
  const hasHostedTools = chatRequestHasHostedTools(chatBody);
  if (!hasHostedTools && (meta.openaiChat?.preferResponses !== true || !hasFunctionTools)) {
    return null;
  }
  const result = convertOpenAIMessageRequestToResponsesRequest(
    chatBody as unknown as OpenAIMessageRequest
  );
  return {
    body: result.request,
    path: result.newPath,
    responseFormat: "responses",
  };
}

function chatRequestHasHostedTools(data: Record<string, unknown>): boolean {
  const tools = data.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return false;
  }
  return tools.some(t => {
    if (!t || typeof t !== "object") {
      return false;
    }
    const typ = (t as { type?: unknown }).type;
    return typeof typ === "string" && typ.length > 0 && typ !== "function";
  });
}

/**
 * Parse a Chat Completions JSON buffer and produce a Responses request body buffer.
 * Returns `null` if the body is not a valid Chat Completions request.
 */
export function convertOpenAiChatBodyBufferToResponsesRequest(
  body: Buffer
): ChatToResponsesRequestResult | null {
  try {
    const raw = JSON.parse(body.toString("utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.messages)) {
      return null;
    }
    const chat = o as unknown as OpenAIMessageRequest;
    return convertOpenAIMessageRequestToResponsesRequest(chat);
  } catch {
    return null;
  }
}
