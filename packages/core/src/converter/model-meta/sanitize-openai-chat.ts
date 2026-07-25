import { ScopedLogger } from "../../utils/logger";
import { resolveModelMeta } from "./registry";
import type { ModelMeta } from "./types";

const log = new ScopedLogger("ModelMeta");

function chatRequestHasFunctionTools(data: Record<string, unknown>): boolean {
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
  } else if (
    openaiChat?.dropReasoningEffortWhenTools &&
    data.reasoning_effort !== undefined &&
    chatRequestHasFunctionTools(data)
  ) {
    // gpt-5 / o-series: Chat Completions rejects tools + reasoning_effort together
    // ("Please use /v1/responses instead"). Prefer keeping tools for Codex agent turns.
    delete data.reasoning_effort;
    stripped.push("reasoning_effort");
  } else if (
    openaiChat?.validReasoningEfforts &&
    typeof data.reasoning_effort === "string" &&
    data.reasoning_effort.trim() !== ""
  ) {
    const effort = data.reasoning_effort.trim().toLowerCase();
    const allowed = new Set(openaiChat.validReasoningEfforts.map(e => e.toLowerCase()));
    if (!allowed.has(effort)) {
      delete data.reasoning_effort;
      stripped.push("reasoning_effort");
    }
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
