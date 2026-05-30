/**
 * Reconstruct a merged OpenAI Chat Completions `chat.completion` object from an SSE log body
 * (`data:` lines with `object: "chat.completion.chunk"`). Supports `reasoning_content` (MiMo/DeepSeek)
 * and streamed `tool_calls` deltas.
 */

export type ReconstructOpenAIChatResult =
  | { ok: true; message: Record<string, unknown> }
  | { ok: false; reason: string };

interface ToolCallAccum {
  id?: string;
  type: string;
  function: { name: string; arguments: string };
}

function parseDataPayload(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("data:")) {
    return null;
  }
  const rest = t.slice(5).trimStart();
  if (!rest || rest === "[DONE]") {
    return null;
  }
  return rest;
}

/** True when the body contains Chat Completions stream chunks. */
export function isOpenAIChatCompletionSseBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  for (const line of trimmed.split("\n")) {
    const dataStr = parseDataPayload(line);
    if (!dataStr) {
      continue;
    }
    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;
      if (data.object === "chat.completion.chunk") {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function reconstructOpenAIChatFromSseLogBody(body: string): ReconstructOpenAIChatResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (!isOpenAIChatCompletionSseBody(trimmed)) {
    return { ok: false, reason: "not_openai_chat_sse" };
  }

  let id: string | undefined;
  let created: number | undefined;
  let model: string | undefined;
  let role = "assistant";
  let contentBuf = "";
  let reasoningBuf = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | undefined;
  const toolCallsByIndex = new Map<number, ToolCallAccum>();

  for (const line of trimmed.split("\n")) {
    const dataStr = parseDataPayload(line);
    if (!dataStr) {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (typeof data.id === "string") {
      id = data.id;
    }
    if (typeof data.created === "number") {
      created = data.created;
    }
    if (typeof data.model === "string" && data.model) {
      model = data.model;
    }
    if (data.usage && typeof data.usage === "object") {
      usage = { ...(data.usage as Record<string, unknown>) };
    }

    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      continue;
    }

    const choice = choices[0] as Record<string, unknown>;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      finishReason = String(choice.finish_reason);
    }

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) {
      continue;
    }

    if (typeof delta.role === "string" && delta.role) {
      role = delta.role;
    }

    if (typeof delta.content === "string") {
      contentBuf += delta.content;
    }

    if (typeof delta.reasoning_content === "string") {
      reasoningBuf += delta.reasoning_content;
    }

    const toolCalls = delta.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") {
          continue;
        }
        const tco = tc as Record<string, unknown>;
        const tcIndex = typeof tco.index === "number" ? tco.index : 0;
        let acc = toolCallsByIndex.get(tcIndex);
        if (!acc) {
          acc = { type: "function", function: { name: "", arguments: "" } };
          toolCallsByIndex.set(tcIndex, acc);
        }
        if (typeof tco.id === "string" && tco.id) {
          acc.id = tco.id;
        }
        if (typeof tco.type === "string" && tco.type) {
          acc.type = tco.type;
        }
        const fn = tco.function as Record<string, unknown> | undefined;
        if (fn) {
          if (typeof fn.name === "string" && fn.name) {
            acc.function.name = fn.name;
          }
          if (typeof fn.arguments === "string" && fn.arguments) {
            acc.function.arguments += fn.arguments;
          }
        }
      }
    }
  }

  const message: Record<string, unknown> = {
    role,
    content: contentBuf.length > 0 ? contentBuf : null,
  };
  if (reasoningBuf.length > 0) {
    message.reasoning_content = reasoningBuf;
  }

  const toolIndices = [...toolCallsByIndex.keys()].sort((a, b) => a - b);
  if (toolIndices.length > 0) {
    message.tool_calls = toolIndices.map(i => {
      const t = toolCallsByIndex.get(i)!;
      const out: Record<string, unknown> = {
        type: t.type,
        function: { name: t.function.name, arguments: t.function.arguments },
      };
      if (t.id) {
        out.id = t.id;
      }
      return out;
    });
  }

  const completion: Record<string, unknown> = {
    id: id ?? "",
    object: "chat.completion",
    created: created ?? 0,
    model: model ?? "",
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
  };
  if (usage) {
    completion.usage = usage;
  }

  return { ok: true, message: completion };
}
