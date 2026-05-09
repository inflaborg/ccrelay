/**
 * OpenAI Responses API JSON → Anthropic Messages non-streaming response (protocol-level mapping).
 * Hosted web_search shaping lives in platform-transforms (`azure-openai/responses-web-search`).
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire API keys */

import { randomUUID } from "crypto";

import type {
  AnthropicContentBlock,
  AnthropicMessageResponse,
  AnthropicUsage,
} from "./openai-chat-to-anthropic-response";

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

function parseFunctionArguments(argStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argStr) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Collect assistant-visible text from Responses message content (`output_text` blocks). */
function collectOutputText(content: unknown): string[] {
  const textParts: string[] = [];
  if (!Array.isArray(content)) {
    return textParts;
  }
  for (const block of content) {
    const b = asRecord(block);
    if (!b) {
      continue;
    }
    const typ = typeof b.type === "string" ? b.type : "";
    if (typ === "output_text" && typeof b.text === "string") {
      textParts.push(b.text);
    }
  }
  return textParts;
}

function buildStructuralContentFromOutput(output: unknown): AnthropicContentBlock[] {
  if (!Array.isArray(output)) {
    return [{ type: "text", text: "" }];
  }

  const blocks: AnthropicContentBlock[] = [];

  for (const item of output) {
    const o = asRecord(item);
    if (!o) {
      continue;
    }
    const typ = typeof o.type === "string" ? o.type : "";

    if (typ === "web_search_call") {
      continue;
    }

    if (typ === "message") {
      const content = o.content;
      const textParts = collectOutputText(content);
      const joined = textParts.join("");
      if (joined.length > 0) {
        blocks.push({ type: "text", text: joined });
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
            : `toolu_${randomUUID().replace(/-/g, "")}`;
      blocks.push({
        type: "tool_use",
        id: callId,
        name,
        input: parseFunctionArguments(argStr),
      });
    }
  }

  if (blocks.length === 0) {
    return [{ type: "text", text: "" }];
  }

  return blocks;
}

function mapUsage(u: unknown): AnthropicUsage | undefined {
  const r = asRecord(u);
  if (!r) {
    return undefined;
  }
  const inTok = r.input_tokens;
  const outTok = r.output_tokens;
  if (typeof inTok !== "number" && typeof outTok !== "number") {
    return undefined;
  }
  return {
    input_tokens: typeof inTok === "number" ? inTok : 0,
    output_tokens: typeof outTok === "number" ? outTok : 0,
    cache_read_input_tokens: 0,
  };
}

/**
 * True if JSON looks like a completed Responses API object with `output[]`.
 */
export function isOpenAIResponsesApiResultBody(body: Record<string, unknown>): boolean {
  return body.object === "response" && Array.isArray(body.output);
}

/**
 * Convert OpenAI Responses `POST /responses` JSON to Anthropic Messages response shape.
 */
export function convertResponsesApiJsonToAnthropicMessageResponse(
  body: Record<string, unknown>,
  originalModel: string
): AnthropicMessageResponse {
  const id =
    typeof body.id === "string" && body.id.length > 0
      ? body.id
      : `msg_${randomUUID().replace(/-/g, "")}`;
  const model =
    typeof body.model === "string" && body.model.length > 0 ? body.model : originalModel;

  const content = buildStructuralContentFromOutput(body.output);

  return {
    id,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: mapUsage(body.usage) ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
