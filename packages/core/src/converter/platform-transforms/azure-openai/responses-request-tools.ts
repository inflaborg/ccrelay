/**
 * Azure OpenAI Responses API: hosted `web_search` tools accept only `type` + optional `user_location`
 * (Chat Completions may carry `max_uses`, nested envelopes, etc.).
 */

function isHostedWebSearchToolType(typ: string): boolean {
  return typ === "web_search" || typ.startsWith("web_search");
}

/**
 * Normalize one Responses `tools[]` entry for Azure hosted web search; other tools unchanged.
 */
export function mapAzureResponsesToolEntryForHostedWebSearch(
  tool: Record<string, unknown>
): Record<string, unknown> {
  const typ = typeof tool.type === "string" ? tool.type : "";
  if (!isHostedWebSearchToolType(typ)) {
    return tool;
  }
  const out: Record<string, unknown> = { type: "web_search" };
  const ul = tool.user_location;
  if (ul && typeof ul === "object" && !Array.isArray(ul)) {
    out.user_location = ul;
  }
  return out;
}

/**
 * In-place: rewrite `request.tools` for Azure Responses `web_search` constraints.
 */
export function sanitizeAzureResponsesRequestTools(request: Record<string, unknown>): void {
  const tools = request.tools;
  if (!Array.isArray(tools)) {
    return;
  }
  request.tools = tools.map((entry: unknown): unknown => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    return mapAzureResponsesToolEntryForHostedWebSearch(entry as Record<string, unknown>);
  });
}
