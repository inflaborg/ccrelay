/**
 * Gemini OpenAI-compatible Chat Completions: strip fields and tools the upstream rejects.
 */

/**
 * Remove top-level and message-level fields, and non-`function` tools, that
 * `generativelanguage.googleapis.com` OpenAI-compat does not accept.
 */
export function geminiChatSanitize(data: Record<string, unknown>): void {
  delete data.reasoning;

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
