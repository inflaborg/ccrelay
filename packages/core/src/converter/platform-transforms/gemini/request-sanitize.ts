/**
 * Gemini OpenAI-compatible Chat Completions: strip fields and tools the upstream rejects.
 */

const GEMINI_VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);

/**
 * Whether `reasoning_effort: "none"` is valid for this Gemini model (2.5 Flash family).
 * 2.5 Pro and Gemini 3+ cannot disable thinking per Gemini docs.
 */
export function canGeminiDisableThinking(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes("2.5-pro")) {
    return false;
  }
  const major = m.match(/gemini-(\d+)/);
  if (major && parseInt(major[1], 10) >= 3) {
    return false;
  }
  return true;
}

/**
 * Normalize a Chat Completions `reasoning_effort` string for Gemini, or `undefined`
 * to omit the field (Gemini model default).
 */
export function normalizeGeminiEffort(effort: string, model: string): string | undefined {
  const e = effort.toLowerCase();
  if (e === "xhigh") {
    return "high";
  }
  if (e === "none") {
    return canGeminiDisableThinking(model) ? "none" : undefined;
  }
  return GEMINI_VALID_EFFORTS.has(e) ? e : undefined;
}

/**
 * Remove top-level and message-level fields, and non-`function` tools, that
 * `generativelanguage.googleapis.com` OpenAI-compat does not accept.
 */
export function geminiChatSanitize(data: Record<string, unknown>): void {
  delete data.reasoning;

  if (typeof data.reasoning_effort === "string") {
    const model = typeof data.model === "string" ? data.model : "";
    const normalized = normalizeGeminiEffort(data.reasoning_effort, model);
    if (normalized !== undefined) {
      data.reasoning_effort = normalized;
    } else {
      delete data.reasoning_effort;
    }
  }

  const messages = data.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg && typeof msg === "object" && "thinking" in msg) {
        delete (msg as Record<string, unknown>).thinking;
      }
    }
  }

  const tools = data.tools;
  if (!Array.isArray(tools)) {
    return;
  }

  const kept = tools.filter(
    t => t && typeof t === "object" && (t as Record<string, unknown>).type === "function"
  );
  if (kept.length === 0) {
    delete data.tools;
    delete data.tool_choice;
  } else {
    data.tools = kept;
  }
}
