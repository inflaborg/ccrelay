/**
 * Reconstruct a single Anthropic-style Messages `message` object from an SSE log body
 * (event:/data: lines with JSON payloads). Transport events are folded into merged
 * `content` blocks by index; incomplete streams still emit partial blocks (policy A).
 */

export type ReconstructMessageResult =
  | { ok: true; message: Record<string, unknown> }
  | { ok: false; reason: string };

interface WorkingBlock {
  contentBlock: Record<string, unknown>;
  textDeltaBuf: string;
  inputJsonBuf: string;
}

function isSseLogBody(trimmed: string): boolean {
  return trimmed.startsWith("event:") || trimmed.startsWith("data:");
}

function shallowCloneUsage(u: unknown): Record<string, unknown> | undefined {
  if (u && typeof u === "object" && !Array.isArray(u)) {
    return { ...(u as Record<string, unknown>) };
  }
  return undefined;
}

function finalizeContentBlock(block: WorkingBlock): Record<string, unknown> {
  const cb = block.contentBlock;
  const bType = cb.type as string | undefined;

  if (bType === "text") {
    const base = typeof cb.text === "string" ? cb.text : "";
    return { type: "text", text: base + block.textDeltaBuf };
  }

  if (bType === "tool_use" || bType === "server_tool_use") {
    let input: unknown = cb.input;
    if (input === undefined || input === null) {
      if (block.inputJsonBuf.trim()) {
        try {
          input = JSON.parse(block.inputJsonBuf);
        } catch {
          input = { _parseError: true, raw: block.inputJsonBuf };
        }
      } else {
        input = {};
      }
    } else if (typeof input === "object" && input !== null && block.inputJsonBuf.trim()) {
      try {
        const add = JSON.parse(block.inputJsonBuf) as Record<string, unknown>;
        input = { ...(input as Record<string, unknown>), ...add };
      } catch {
        // keep start payload only
      }
    }

    const out: Record<string, unknown> = {
      type: bType,
      id: cb.id,
      name: cb.name,
      input,
    };
    return out;
  }

  const cloned = structuredClone(cb) as Record<string, unknown>;
  if (bType === "thinking" && block.textDeltaBuf) {
    const prev = typeof cloned.thinking === "string" ? cloned.thinking : "";
    cloned.thinking = prev + block.textDeltaBuf;
  }
  return cloned;
}

/**
 * Parse `responseBody` that looks like Anthropic SSE. Returns `ok: false` with
 * `reason: "not_sse"` when the body is not SSE (caller may pretty-print raw JSON instead).
 */
export function reconstructMessageFromSseLogBody(body: string): ReconstructMessageResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (!isSseLogBody(trimmed)) {
    return { ok: false, reason: "not_sse" };
  }

  let envelope: Record<string, unknown> | null = null;
  const activeBlocks = new Map<number, WorkingBlock>();
  const finalizedByIndex: Record<number, unknown> = {};

  const lines = trimmed.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === "[DONE]") {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr) as Record<string, unknown>;
    } catch {
      continue;
    }

    const evType = data.type as string | undefined;

    if (evType === "message_start" && data.message && typeof data.message === "object") {
      const msg = data.message as Record<string, unknown>;
      envelope = {
        id: msg.id,
        type: msg.type ?? "message",
        role: msg.role,
        model: msg.model,
        content: [],
        stop_reason: msg.stop_reason ?? null,
        stop_sequence: msg.stop_sequence ?? null,
        usage: shallowCloneUsage(msg.usage),
      };
      continue;
    }

    if (!envelope) {
      continue;
    }

    if (evType === "content_block_start") {
      const index = data.index;
      const cb = data.content_block;
      if (typeof index !== "number" || !cb || typeof cb !== "object") {
        continue;
      }
      activeBlocks.set(index, {
        contentBlock: structuredClone(cb) as Record<string, unknown>,
        textDeltaBuf: "",
        inputJsonBuf: "",
      });
      continue;
    }

    if (evType === "content_block_delta") {
      const index = data.index;
      const block = typeof index === "number" ? activeBlocks.get(index) : undefined;
      if (!block) {
        continue;
      }
      const delta = data.delta;
      if (!delta || typeof delta !== "object") {
        continue;
      }
      const d = delta as Record<string, unknown>;
      const dType = d.type as string | undefined;
      if (dType === "text_delta" && typeof d.text === "string") {
        block.textDeltaBuf += d.text;
      } else if (dType === "thinking_delta" && typeof d.thinking === "string") {
        block.textDeltaBuf += d.thinking;
      } else if (dType === "input_json_delta" && typeof d.partial_json === "string") {
        block.inputJsonBuf += d.partial_json;
      }
      continue;
    }

    if (evType === "content_block_stop") {
      const index = data.index;
      if (typeof index !== "number") {
        continue;
      }
      const block = activeBlocks.get(index);
      if (block) {
        finalizedByIndex[index] = finalizeContentBlock(block);
        activeBlocks.delete(index);
      }
      continue;
    }

    if (evType === "message_delta") {
      const delta = data.delta;
      if (delta && typeof delta === "object") {
        const d = delta as Record<string, unknown>;
        if ("stop_reason" in d) {
          envelope.stop_reason = d.stop_reason;
        }
        if ("stop_sequence" in d) {
          envelope.stop_sequence = d.stop_sequence;
        }
      }
      if (data.usage && typeof data.usage === "object") {
        const u = data.usage as Record<string, unknown>;
        const prev = (envelope.usage as Record<string, unknown>) || {};
        envelope.usage = { ...prev, ...u };
      }
      continue;
    }
  }

  if (!envelope) {
    return { ok: false, reason: "no_message_start" };
  }

  // Policy A: emit partial blocks for any index that never received content_block_stop.
  for (const [index, block] of activeBlocks) {
    const fin = finalizeContentBlock(block) as Record<string, unknown>;
    fin._incomplete = true;
    finalizedByIndex[index] = fin;
  }

  const indices = Object.keys(finalizedByIndex)
    .map(Number)
    .sort((a, b) => a - b);
  envelope.content = indices.map(i => finalizedByIndex[i]);

  return { ok: true, message: envelope };
}
