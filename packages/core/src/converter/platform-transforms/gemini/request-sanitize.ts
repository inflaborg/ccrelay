/**
 * Gemini OpenAI-compatible Chat Completions: strip fields and tools the upstream rejects.
 */

/* eslint-disable @typescript-eslint/naming-convention -- Gemini OpenAI-compat wire uses snake_case */

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

/** Gemini 2.5 family uses `thinking_budget` in `thinking_config`. */
export function isGemini25Model(model: string): boolean {
  return model.toLowerCase().includes("2.5");
}

/**
 * Map OpenAI-style effort to a 2.5 `thinking_budget` (integers per Gemini docs).
 * `none` is handled separately (budget 0 when disabling is allowed).
 */
export function getGeminiThinkingBudget(effort: string): number | undefined {
  const e = effort.toLowerCase();
  switch (e) {
    case "minimal":
    case "low":
      return 1024;
    case "medium":
      return 8192;
    case "high":
    case "xhigh":
      return 24576;
    default:
      return undefined;
  }
}

/**
 * Map effort to Gemini 3+ `thinking_level` string.
 */
export function getGeminiThinkingLevel(effort: string): string | undefined {
  const e = effort.toLowerCase();
  if (e === "xhigh") {
    return "high";
  }
  if (e === "minimal" || e === "low" || e === "medium" || e === "high") {
    return e;
  }
  return undefined;
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

function userHasThinkingConfig(data: Record<string, unknown>): boolean {
  const eb = data.extra_body;
  if (!eb || typeof eb !== "object" || Array.isArray(eb)) {
    return false;
  }
  const google = (eb as Record<string, unknown>).google;
  if (!google || typeof google !== "object" || Array.isArray(google)) {
    return false;
  }
  const tc = (google as Record<string, unknown>).thinking_config;
  return tc !== undefined && tc !== null && typeof tc === "object";
}

function getOrCreateExtraBodyGoogle(data: Record<string, unknown>): Record<string, unknown> {
  let extraBody = data.extra_body;
  if (!extraBody || typeof extraBody !== "object" || Array.isArray(extraBody)) {
    extraBody = {};
    data.extra_body = extraBody;
  }
  const eb = extraBody as Record<string, unknown>;
  let google = eb.google;
  if (!google || typeof google !== "object" || Array.isArray(google)) {
    google = {};
    eb.google = google;
  }
  return google as Record<string, unknown>;
}

/**
 * Remove top-level and message-level fields, and non-`function` tools, that
 * `generativelanguage.googleapis.com` OpenAI-compat does not accept.
 */
export function geminiChatSanitize(data: Record<string, unknown>): void {
  delete data.reasoning;
  delete data.google;

  if (typeof data.reasoning_effort === "string" && data.reasoning_effort.trim() !== "") {
    const model = typeof data.model === "string" ? data.model : "";
    const effort = data.reasoning_effort.trim().toLowerCase();

    if (userHasThinkingConfig(data)) {
      delete data.reasoning_effort;
    } else if (effort === "none") {
      if (canGeminiDisableThinking(model)) {
        const google = getOrCreateExtraBodyGoogle(data);
        google.thinking_config = { thinking_budget: 0 };
      }
      delete data.reasoning_effort;
    } else {
      const normalized = normalizeGeminiEffort(data.reasoning_effort, model);
      if (normalized === undefined) {
        delete data.reasoning_effort;
      } else if (isGemini25Model(model)) {
        const budget = getGeminiThinkingBudget(normalized);
        if (budget === undefined) {
          delete data.reasoning_effort;
        } else {
          const google = getOrCreateExtraBodyGoogle(data);
          google.thinking_config = { thinking_budget: budget, include_thoughts: true };
          delete data.reasoning_effort;
        }
      } else {
        const level = getGeminiThinkingLevel(normalized);
        if (level === undefined) {
          delete data.reasoning_effort;
        } else {
          const google = getOrCreateExtraBodyGoogle(data);
          google.thinking_config = { thinking_level: level, include_thoughts: true };
          delete data.reasoning_effort;
        }
      }
    }
  }

  const messages = data.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") {
        continue;
      }
      const m = msg as Record<string, unknown>;
      const thinking = m.thinking;
      if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
        const t = thinking as Record<string, unknown>;
        const sig =
          typeof t.signature === "string" && t.signature.length > 0 ? t.signature : undefined;
        if (sig) {
          const toolCalls = m.tool_calls;
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (!tc || typeof tc !== "object" || Array.isArray(tc)) {
                continue;
              }
              const tcr = tc as Record<string, unknown>;
              const existing = tcr.extra_content;
              const existingObj =
                existing && typeof existing === "object" && !Array.isArray(existing)
                  ? (existing as Record<string, unknown>)
                  : {};
              const googleRaw = existingObj.google;
              const google =
                googleRaw && typeof googleRaw === "object" && !Array.isArray(googleRaw)
                  ? { ...(googleRaw as Record<string, unknown>) }
                  : {};
              google.thought_signature = sig;
              tcr.extra_content = { ...existingObj, google };
            }
          }
        }
        delete m.thinking;
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
