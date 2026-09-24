import { ScopedLogger } from "../../utils/logger";
import { resolveModelMeta } from "./registry";
import type { ModelMeta } from "./types";

const log = new ScopedLogger("ModelMeta");

export function openAiChatRequestHasFunctionTools(data: Record<string, unknown>): boolean {
  const tools = data.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return false;
  }
  return tools.some(t => {
    if (!t || typeof t !== "object") {
      return false;
    }
    const o = t as Record<string, unknown>;
    // Chat Completions: { type: "function", function: {...} }
    if (o.type === "function") {
      return true;
    }
    // Defensive: some converters may leave bare function objects
    return typeof o.function === "object" && o.function !== null;
  });
}

function allowedReasoningEfforts(meta: ModelMeta): Set<string> | undefined {
  const list = meta.openaiChat?.validReasoningEfforts;
  if (!list || list.length === 0) {
    return undefined;
  }
  return new Set(list.map(e => e.toLowerCase()));
}

/**
 * Map a Chat Completions `reasoning_effort` onto a value the model accepts.
 * Returns `undefined` when the field should be omitted.
 */
export function normalizeOpenAiChatReasoningEffort(
  effort: string,
  meta: ModelMeta
): string | undefined {
  const trimmed = effort.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const allowed = allowedReasoningEfforts(meta);
  if (!allowed) {
    return trimmed;
  }
  if (allowed.has(trimmed)) {
    return trimmed;
  }
  const aliased = meta.openaiChat?.reasoningEffortAliases?.[trimmed]?.toLowerCase();
  if (aliased && allowed.has(aliased)) {
    return aliased;
  }
  return undefined;
}

function applyNormalizedReasoningEffort(
  data: Record<string, unknown>,
  meta: ModelMeta,
  stripped: string[]
): void {
  if (typeof data.reasoning_effort !== "string") {
    return;
  }
  const normalized = normalizeOpenAiChatReasoningEffort(data.reasoning_effort, meta);
  const current = data.reasoning_effort.trim().toLowerCase();
  if (normalized === undefined) {
    delete data.reasoning_effort;
    stripped.push("reasoning_effort");
    return;
  }
  if (normalized !== current) {
    data.reasoning_effort = normalized;
    stripped.push(`reasoning_effort=${normalized}`);
  }
}

/**
 * Strip OpenAI Chat Completions fields unsupported by the resolved model meta.
 */
export function sanitizeOpenAiChatRequestByMeta(
  data: Record<string, unknown>,
  meta: ModelMeta
): string[] {
  const stripped: string[] = [];
  const reasoning = meta.reasoning;
  const openaiChat = meta.openaiChat;
  if (!reasoning.supportsReasoningEffort && data.reasoning_effort !== undefined) {
    delete data.reasoning_effort;
    stripped.push("reasoning_effort");
  } else if (openaiChat?.dropReasoningEffortWhenTools && openAiChatRequestHasFunctionTools(data)) {
    // gpt-5.4+ / gpt-6 Chat Completions: function tools only with reasoning_effort "none".
    const current =
      typeof data.reasoning_effort === "string" ? data.reasoning_effort.trim().toLowerCase() : "";
    if (current !== "none") {
      data.reasoning_effort = "none";
      stripped.push("reasoning_effort=none");
    }
    if (data.reasoning !== undefined) {
      delete data.reasoning;
      stripped.push("reasoning");
    }
  } else {
    applyNormalizedReasoningEffort(data, meta, stripped);
  }

  if (stripped.length > 0) {
    const modelLabel = typeof data.model === "string" ? data.model : "?";
    log.warn(
      `[model-meta] stripped ${stripped.join(", ")} for ${modelLabel} ` +
        `(family=${meta.id}, vendor=${meta.vendor})`
    );
  }

  return stripped;
}

export function sanitizeOpenAiChatRequestRecord(data: Record<string, unknown>): void {
  const model = typeof data.model === "string" ? data.model : "";
  const meta = resolveModelMeta(model, { vendor: inferOpenAiVendor(model) });
  sanitizeOpenAiChatRequestByMeta(data, meta);
}

function inferOpenAiVendor(model: string): ModelMeta["vendor"] {
  const m = model.toLowerCase();
  if (m.includes("gemini")) {
    return "gemini";
  }
  if (m.includes("deepseek")) {
    return "deepseek";
  }
  return "openai";
}
