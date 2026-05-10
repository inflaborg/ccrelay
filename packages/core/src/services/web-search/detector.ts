import type { ApiSurface } from "../../types";
import type { WebSearchDetectionResult } from "./types";

/**
 * Detect whether a request is a web_search tool call that should be intercepted.
 * Pure function — no I/O, fully testable.
 */
export function detectWebSearchCall(
  rawBody: Buffer,
  clientSurface: ApiSurface
): WebSearchDetectionResult {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
  } catch {
    return { intercept: false };
  }

  // Must have exactly 1 tool
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length !== 1) {
    return { intercept: false };
  }

  // That tool must be web_search
  const tool = tools[0] as Record<string, unknown> | undefined;
  if (!tool || typeof tool !== "object") {
    return { intercept: false };
  }

  if (!isWebSearchTool(tool)) {
    return { intercept: false };
  }

  // Extract query from last user message
  const query = extractQueryFromMessages(body, clientSurface);
  if (!query) {
    return { intercept: false };
  }

  return {
    intercept: true,
    query,
    stream: body.stream === true,
    model: typeof body.model === "string" ? body.model : "",
    clientSurface,
  };
}

function isWebSearchTool(tool: Record<string, unknown>): boolean {
  const typ = typeof tool.type === "string" ? tool.type : "";
  const name = typeof tool.name === "string" ? tool.name : "";
  if (name === "web_search") {
    return true;
  }
  if (typ.startsWith("web_search_")) {
    return true;
  }
  return false;
}

/**
 * Extract search query from messages.
 *
 * Anthropic tool call request: single user message with text like
 * "Perform a web search for the query: <query>"
 *
 * OpenAI Chat: similar pattern with role "user" content string.
 */
function extractQueryFromMessages(
  body: Record<string, unknown>,
  _clientSurface: ApiSurface
): string | null {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  // Find last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "user") {
      continue;
    }

    const text = extractTextFromContent(msg.content);
    if (text && text.trim().length > 0) {
      return text.trim();
    }
  }

  return null;
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  // Anthropic content block array: [{ type: "text", text: "..." }]
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        return (block as Record<string, unknown>).text as string;
      }
    }
  }

  return null;
}
