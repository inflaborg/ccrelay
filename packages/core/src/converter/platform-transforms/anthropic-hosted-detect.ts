/**
 * Detect Anthropic Messages request bodies that declare hosted web search server tools.
 */

const VERSION_STAMP_SUFFIX = /^(.+)_(\d{8})$/;

function strippedToolType(typ: string): string {
  const m = VERSION_STAMP_SUFFIX.exec(typ);
  return m?.[1] ?? typ;
}

function isHostedWebSearchServerTool(tool: Record<string, unknown>): boolean {
  const typ = typeof tool.type === "string" ? tool.type : "";
  const name = typeof tool.name === "string" ? tool.name : "";
  if (name === "web_search") {
    return true;
  }
  if (typ.startsWith("web_search_")) {
    return true;
  }
  if (strippedToolType(typ) === "web_search") {
    return true;
  }
  if (name.includes("web_search")) {
    return true;
  }
  return false;
}

/**
 * `/v1/messages` JSON: **`tools` only** — must include a hosted web-search server tool declaration.
 * Do not infer from `messages` / tool blocks: multi-turn turns are not necessarily search.
 */
export function anthropicMessagesBodyHasHostedWebSearch(body: Record<string, unknown>): boolean {
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const t of tools) {
    if (!t || typeof t !== "object") {
      continue;
    }
    if (isHostedWebSearchServerTool(t as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
}
