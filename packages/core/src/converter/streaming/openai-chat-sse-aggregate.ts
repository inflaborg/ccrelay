/**
 * Buffered OpenAI-compatible bodies → one complete object.
 *
 * Some upstreams ignore `stream: false` and answer with `text/event-stream` (a full
 * `chat.completion` JSON, a single `data:` line, or real `chat.completion.chunk` deltas).
 * These helpers fold such bodies back into the non-streaming shape so the JSON converters apply.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import type {
  OpenAIChatCompletionResponse,
  OpenAIToolCall,
  OpenAIUsage,
} from "../adapters/openai-chat-to-anthropic-response";

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

/** JSON payloads of every `data:` line (skips `[DONE]`, comments, and malformed lines). */
export function parseSseDataPayloads(body: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = asRecord(JSON.parse(payload));
      if (parsed) {
        out.push(parsed);
      }
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function isCompleteChatCompletion(obj: Record<string, unknown>): boolean {
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }
  const first = asRecord(choices[0]);
  return Boolean(first && asRecord(first.message));
}

interface ToolAccum {
  id: string;
  type: string;
  name: string;
  arguments: string;
  thoughtSignature?: string;
}

/**
 * Fold `chat.completion.chunk` deltas (or an embedded full `chat.completion`) into one
 * `chat.completion`. Returns null when the body carries no choices (e.g. an error payload).
 */
export function aggregateOpenAiChatSseToCompletion(
  body: string
): OpenAIChatCompletionResponse | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = asRecord(JSON.parse(trimmed));
      if (parsed && isCompleteChatCompletion(parsed)) {
        return parsed as unknown as OpenAIChatCompletionResponse;
      }
    } catch {
      /* not a single JSON document — fall through to SSE parsing */
    }
  }

  const payloads = parseSseDataPayloads(body);
  if (payloads.length === 0) {
    return null;
  }

  for (let i = payloads.length - 1; i >= 0; i--) {
    if (isCompleteChatCompletion(payloads[i])) {
      return payloads[i] as unknown as OpenAIChatCompletionResponse;
    }
  }

  let id = "";
  let model = "";
  let created = 0;
  let sawChoice = false;
  let content = "";
  let reasoning = "";
  let thinkingContent = "";
  let thinkingSignature: string | undefined;
  let finishReason = "";
  let usage: OpenAIUsage | undefined;
  const annotations: unknown[] = [];
  const tools: ToolAccum[] = [];

  for (const chunk of payloads) {
    if (!id && typeof chunk.id === "string") {
      id = chunk.id;
    }
    if (typeof chunk.model === "string" && chunk.model) {
      model = chunk.model;
    }
    if (!created && typeof chunk.created === "number") {
      created = chunk.created;
    }
    const u = asRecord(chunk.usage);
    if (u) {
      usage = u as unknown as OpenAIUsage;
    }

    const choices = chunk.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      continue;
    }
    const choice = asRecord(choices[0]);
    if (!choice) {
      continue;
    }
    sawChoice = true;
    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const delta = asRecord(choice.delta);
    if (!delta) {
      continue;
    }
    if (typeof delta.content === "string") {
      content += delta.content;
    }
    if (typeof delta.reasoning_content === "string") {
      reasoning += delta.reasoning_content;
    }
    const thinking = asRecord(delta.thinking);
    if (thinking) {
      if (typeof thinking.content === "string") {
        thinkingContent += thinking.content;
      }
      if (typeof thinking.signature === "string" && thinking.signature) {
        thinkingSignature = thinking.signature;
      }
    }
    if (Array.isArray(delta.annotations)) {
      annotations.push(...(delta.annotations as unknown[]));
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const tc = asRecord(raw);
        if (!tc) {
          continue;
        }
        const index = typeof tc.index === "number" ? tc.index : tools.length;
        const fn = asRecord(tc.function);
        const acc = (tools[index] ??= { id: "", type: "function", name: "", arguments: "" });
        if (typeof tc.id === "string" && tc.id) {
          acc.id = tc.id;
        }
        if (typeof tc.type === "string" && tc.type) {
          acc.type = tc.type;
        }
        if (fn) {
          if (typeof fn.name === "string" && fn.name) {
            acc.name = fn.name;
          }
          if (typeof fn.arguments === "string") {
            acc.arguments += fn.arguments;
          }
          if (typeof fn.thought_signature === "string" && fn.thought_signature) {
            acc.thoughtSignature = fn.thought_signature;
          }
        }
      }
    }
  }

  if (!sawChoice) {
    return null;
  }

  const toolCalls: OpenAIToolCall[] = tools
    .filter((t): t is ToolAccum => Boolean(t))
    .map((t, i) => ({
      id: t.id || `call_${i}`,
      type: t.type,
      function: {
        name: t.name,
        arguments: t.arguments,
        ...(t.thoughtSignature ? { thought_signature: t.thoughtSignature } : {}),
      },
    }));

  const message: OpenAIChatCompletionResponse["choices"][number]["message"] = {
    role: "assistant",
    content,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(thinkingContent || thinkingSignature
      ? {
          thinking: {
            content: thinkingContent,
            ...(thinkingSignature ? { signature: thinkingSignature } : {}),
          },
        }
      : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(annotations.length > 0
      ? { annotations: annotations as NonNullable<typeof message.annotations> }
      : {}),
  };

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason || (toolCalls.length > 0 ? "tool_calls" : "stop"),
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

/**
 * Extract the final Responses API object from a buffered Responses SSE body
 * (`response.completed` / `response.incomplete`), or from a plain JSON body.
 */
export function extractResponsesObjectFromSse(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = asRecord(JSON.parse(trimmed));
      if (parsed && parsed.object === "response") {
        return parsed;
      }
    } catch {
      /* fall through */
    }
  }
  const payloads = parseSseDataPayloads(body);
  for (let i = payloads.length - 1; i >= 0; i--) {
    const p = payloads[i];
    const typ = typeof p.type === "string" ? p.type : "";
    if (typ === "response.completed" || typ === "response.incomplete") {
      const resp = asRecord(p.response);
      if (resp) {
        return resp;
      }
    }
    if (p.object === "response") {
      return p;
    }
  }
  return null;
}
