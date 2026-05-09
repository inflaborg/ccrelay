/**
 * Azure OpenAI Responses API: `web_search_call` output items + `message` items with `url_citation`
 * → Anthropic `server_tool_use` + `web_search_tool_result` (+ text / tool_use).
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire API keys */

import { randomUUID } from "crypto";

import type {
  AnthropicContentBlock,
  AnthropicWebSearchResult,
} from "../../adapters/openai-chat-to-anthropic-response";

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

function extractSearchQueryFromWebSearchCall(item: Record<string, unknown>): string {
  const action = asRecord(item.action);
  if (!action) {
    return "";
  }
  const q = action.query;
  if (typeof q === "string" && q.length > 0) {
    return q;
  }
  const queries = action.queries;
  if (Array.isArray(queries) && queries.length > 0 && typeof queries[0] === "string") {
    return queries[0];
  }
  return "";
}

function mapUrlCitationToSearchResult(
  ann: Record<string, unknown>
): AnthropicWebSearchResult | null {
  const typ = typeof ann.type === "string" ? ann.type : "";
  if (typ.length > 0 && typ !== "url_citation") {
    return null;
  }
  const urlRaw = ann.url;
  const url = typeof urlRaw === "string" ? urlRaw.trim() : "";
  if (url.length === 0) {
    return null;
  }
  const title = typeof ann.title === "string" ? ann.title : "";
  return {
    type: "web_search_result",
    url,
    title,
  };
}

function collectOutputTextAndAnnotations(content: unknown): {
  textParts: string[];
  citations: AnthropicWebSearchResult[];
} {
  const textParts: string[] = [];
  const citations: AnthropicWebSearchResult[] = [];

  if (!Array.isArray(content)) {
    return { textParts, citations };
  }

  for (const block of content) {
    const b = asRecord(block);
    if (!b) {
      continue;
    }
    const typ = typeof b.type === "string" ? b.type : "";
    if (typ === "output_text") {
      if (typeof b.text === "string") {
        textParts.push(b.text);
      }
      const anns = b.annotations;
      if (Array.isArray(anns)) {
        for (const a of anns) {
          const ar = asRecord(a);
          if (!ar) {
            continue;
          }
          const mapped = mapUrlCitationToSearchResult(ar);
          if (mapped) {
            citations.push(mapped);
          }
        }
      }
    }
  }

  return { textParts, citations };
}

function parseFunctionArguments(argStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argStr) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * True when Responses `output[]` needs hosted web search shaping (replaces generic structural mapping).
 */
export function responsesJsonOutputHasHostedWebSearchSignals(
  body: Record<string, unknown>
): boolean {
  const output = body.output;
  if (!Array.isArray(output)) {
    return false;
  }
  for (const item of output) {
    const o = asRecord(item);
    if (!o) {
      continue;
    }
    const typ = typeof o.type === "string" ? o.type : "";
    if (typ === "web_search_call") {
      return true;
    }
    if (typ === "message") {
      const content = o.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        const b = asRecord(block);
        if (!b || typeof b.type !== "string" || b.type !== "output_text") {
          continue;
        }
        const anns = b.annotations;
        if (!Array.isArray(anns)) {
          continue;
        }
        for (const a of anns) {
          const ar = asRecord(a);
          if (ar && (typeof ar.type !== "string" || ar.type === "url_citation")) {
            const url = typeof ar.url === "string" ? ar.url.trim() : "";
            if (url.length > 0) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function buildHostedWebSearchContentFromOutput(output: unknown): AnthropicContentBlock[] {
  if (!Array.isArray(output)) {
    return [{ type: "text", text: "" }];
  }

  const blocks: AnthropicContentBlock[] = [];
  let pendingSearchToolId: string | undefined;

  for (const item of output) {
    const o = asRecord(item);
    if (!o) {
      continue;
    }
    const typ = typeof o.type === "string" ? o.type : "";

    if (typ === "web_search_call") {
      const id =
        typeof o.id === "string" && o.id.length > 0
          ? o.id
          : `srvtoolu_${randomUUID().replace(/-/g, "")}`;
      pendingSearchToolId = id;
      const query = extractSearchQueryFromWebSearchCall(o);
      blocks.push({
        type: "server_tool_use",
        id,
        name: "web_search",
        input: query.length > 0 ? { query } : {},
      });
      continue;
    }

    if (typ === "message") {
      const content = o.content;
      const { textParts, citations } = collectOutputTextAndAnnotations(content);
      if (citations.length > 0 && pendingSearchToolId) {
        blocks.push({
          type: "web_search_tool_result",
          tool_use_id: pendingSearchToolId,
          content: citations,
        });
        pendingSearchToolId = undefined;
      } else if (citations.length > 0 && !pendingSearchToolId) {
        const toolUseId = `srvtoolu_${randomUUID().replace(/-/g, "")}`;
        blocks.push({
          type: "server_tool_use",
          id: toolUseId,
          name: "web_search",
          input: {},
        });
        blocks.push({
          type: "web_search_tool_result",
          tool_use_id: toolUseId,
          content: citations,
        });
      }
      const joined = textParts.join("");
      if (joined.length > 0) {
        blocks.push({ type: "text", text: joined });
      }
      continue;
    }

    if (typ === "function_call") {
      const name = String((o as { name?: string }).name ?? "");
      const argStr =
        typeof o.arguments === "string" ? o.arguments : JSON.stringify(o.arguments ?? {});
      const rawId = o as { call_id?: unknown; id?: unknown };
      const callId =
        typeof rawId.call_id === "string"
          ? rawId.call_id
          : typeof rawId.id === "string"
            ? rawId.id
            : `toolu_${randomUUID().replace(/-/g, "")}`;
      blocks.push({
        type: "tool_use",
        id: callId,
        name,
        input: parseFunctionArguments(argStr),
      });
    }
  }

  if (blocks.length === 0) {
    return [{ type: "text", text: "" }];
  }

  return blocks;
}

/**
 * Merge hosted web search presentation into Anthropic assistant content for Azure Responses JSON.
 * When `output[]` has no web search signals, returns `anthropicContent` unchanged.
 */
export function azureResponsesWebSearchResponseTransform(
  openaiResponseBody: Record<string, unknown>,
  anthropicContent: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  if (!responsesJsonOutputHasHostedWebSearchSignals(openaiResponseBody)) {
    return anthropicContent;
  }
  return buildHostedWebSearchContentFromOutput(openaiResponseBody.output);
}
