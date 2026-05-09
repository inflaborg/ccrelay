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
import { isOpenAIFunctionTool } from "./anthropic-to-openai-chat-request";

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
      const text = messageTextContent(msg);
      if (text.length > 0) {
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const text = messageTextContent(msg);
      const toolCalls = msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          input.push({
            type: "function_call",
            name: tc.function.name,
            arguments: tc.function.arguments,
            call_id: tc.id,
            id: tc.id,
          });
        }
      }
      if (text.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "input_text", text }],
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
    return {
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
    };
  }
  const { type, ...rest } = tool as Record<string, unknown>;
  return { type, ...rest };
}

function mapChatToolChoiceToResponses(tc: OpenAIToolChoice | undefined): unknown {
  if (tc === undefined) {
    return undefined;
  }
  if (tc === "auto" || tc === "none" || tc === "required") {
    return tc;
  }
  if (typeof tc === "object" && tc !== null && "type" in tc && tc.type === "function") {
    return {
      type: "function",
      name: tc.function.name,
    };
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
  const mappedChoice = mapChatToolChoiceToResponses(chat.tool_choice);
  if (mappedChoice !== undefined) {
    out.tool_choice = mappedChoice;
  }

  return {
    request: out,
    newPath: "/responses",
  };
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
