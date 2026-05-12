/* eslint-disable @typescript-eslint/naming-convention -- External API wire fields */

import { Logger } from "../../../utils/logger";
import type { AnthropicSseEventRow } from "../../../converter/platform-transforms/glm/anthropic-sse-emitter";
import { parseAnthropicSseRows } from "../../../converter/platform-transforms/glm/anthropic-sse-emitter";
import { transformGlmAnthropicSearchSseRows } from "../../../converter/platform-transforms/glm/anthropic-sse";
import { glmWebSearchEnvelopeTransform } from "../../../converter/platform-transforms/glm/tools";
import { glmFlattenContentTransform } from "../../../converter/platform-transforms/glm/messages";
import type {
  SearchOptions,
  SearchProvider,
  SearchProviderResponse,
  NormalizedSearchResult,
} from "./types";

const log = Logger.getInstance();
const GLM_TIMEOUT_MS = 90_000;

const DEFAULT_MODEL = "glm-4.7";

/** Build the GLM web_search tool via the shared envelope transform (OpenAI Chat format). */
function buildGlmWebSearchTool(): Record<string, unknown> {
  return glmWebSearchEnvelopeTransform({
    type: "web_search",
    name: "web_search",
    web_search: {
      enable: true,
      search_result: true,
      count: 5,
    },
  });
}

/** Build OpenAI Chat messages array, flattened for GLM via the shared content transform. */
function buildOpenaiMessages(query: string): Array<{ role: string; content: string }> {
  return glmFlattenContentTransform([
    { role: "user", content: [{ type: "text", text: query }] },
  ]) as Array<{ role: string; content: string }>;
}

/**
 * GLM Anthropic `/v1/messages` returns structured `web_search_tool_result` over SSE.
 * Non-streaming JSON responses omit structured hits; match the working proxy path (`stream: true`).
 */
function buildAnthropicBody(query: string, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: 32000,
    stream: true,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: query }],
      },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
  };
}

// -- OpenAI (chat/completions) response types --

interface GlmWebSearchResult {
  title?: string;
  link?: string;
  content?: string;
  media?: string;
  refer?: string;
}

interface GlmChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  web_search?: GlmWebSearchResult[];
}

export class GlmSearchProvider implements SearchProvider {
  readonly name = "glm";

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly model: string = DEFAULT_MODEL,
    private readonly protocol: "anthropic" | "openai" = "openai"
  ) {}

  async search(query: string, _options?: SearchOptions): Promise<SearchProviderResponse> {
    if (this.protocol === "anthropic") {
      return this.searchAnthropic(query);
    }

    const body = {
      model: this.model,
      stream: false,
      max_tokens: 32000,
      messages: buildOpenaiMessages(query),
      tools: [buildGlmWebSearchTool()],
    };
    return this.searchOpenai(query, body);
  }

  private async searchOpenai(
    query: string,
    body: Record<string, unknown>
  ): Promise<SearchProviderResponse> {
    log.info(`[web-search/glm] Searching (openai): "${query}" via ${this.endpoint}`);

    const json = (await this.doFetch(this.endpoint, body)) as GlmChatResponse;
    const results = extractOpenaiResults(json);
    const answer = json.choices?.[0]?.message?.content ?? null;

    log.info(`[web-search/glm] Got ${results.length} results, answer=${answer ? "yes" : "no"}`);
    return { results, answer };
  }

  private async searchAnthropic(query: string): Promise<SearchProviderResponse> {
    const url = `${this.endpoint.replace(/\/$/, "")}/v1/messages`;
    const body = buildAnthropicBody(query, this.model);

    log.info(`[web-search/glm] Searching (anthropic, SSE): "${query}" via ${url}`);

    const raw = (await this.doFetch(url, body, {
      anthropicAuth: true,
      responseFormat: "text",
    })) as string;

    const rows = parseAnthropicSseRows(raw);
    const normalized = transformGlmAnthropicSearchSseRows(rows);
    const { results, answer } = extractFromNormalizedAnthropicSse(normalized);

    log.info(`[web-search/glm] Got ${results.length} results, answer=${answer ? "yes" : "no"}`);
    return { results, answer };
  }

  private async doFetch(
    url: string,
    body: Record<string, unknown>,
    opts: { anthropicAuth?: boolean; responseFormat?: "json" | "text" } = {}
  ): Promise<unknown> {
    const anthropicAuth = opts.anthropicAuth ?? false;
    const responseFormat = opts.responseFormat ?? "json";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (anthropicAuth) {
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GLM_TIMEOUT_MS),
      });
    } catch (err) {
      log.warn(
        `[web-search/glm] Network error: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      log.warn(`[web-search/glm] HTTP ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`GLM API returned HTTP ${res.status}`);
    }

    if (responseFormat === "text") {
      return res.text();
    }
    return res.json();
  }
}

// -- OpenAI response extraction --

function extractOpenaiResults(json: GlmChatResponse): NormalizedSearchResult[] {
  if (!Array.isArray(json.web_search) || json.web_search.length === 0) {
    log.warn("[web-search/glm] No web_search results in response");
    return [];
  }
  return json.web_search.map(item => ({
    url: item.link ?? "",
    title: item.title ?? "",
    content: item.content ?? "",
  }));
}

// -- Anthropic SSE extraction (after `transformGlmAnthropicSearchSseRows`) --

function extractFromNormalizedAnthropicSse(rows: AnthropicSseEventRow[]): {
  results: NormalizedSearchResult[];
  answer: string | null;
} {
  const blockTypes = new Map<number, string>();
  const textByIndex = new Map<number, string>();
  let results: NormalizedSearchResult[] = [];

  for (const row of rows) {
    const d = row.data;
    const top = typeof d.type === "string" ? d.type : "";

    if (top === "content_block_start") {
      const idx = typeof d.index === "number" ? d.index : -1;
      const cb = d.content_block as Record<string, unknown> | undefined;
      const btype = typeof cb?.type === "string" ? cb.type : "";
      if (idx >= 0 && btype) {
        blockTypes.set(idx, btype);
      }

      if (btype === "web_search_tool_result" && cb) {
        const content = cb.content;
        if (Array.isArray(content)) {
          const structured = content
            .filter(
              (item): item is Record<string, unknown> =>
                !!item && typeof item === "object" && !Array.isArray(item)
            )
            .filter(item => item.type === "web_search_result" && typeof item.url === "string")
            .map(item => ({
              url: typeof item.url === "string" ? item.url : "",
              title: typeof item.title === "string" ? item.title : "",
              content: typeof item.encrypted_content === "string" ? item.encrypted_content : "",
            }));
          if (structured.length > 0) {
            results = structured;
          }
        }
      }

      if (btype === "text" && idx >= 0 && cb) {
        const initial = typeof cb.text === "string" ? cb.text : "";
        textByIndex.set(idx, (textByIndex.get(idx) ?? "") + initial);
      }
    }

    if (top === "content_block_delta") {
      const idx = typeof d.index === "number" ? d.index : -1;
      const delta = d.delta as Record<string, unknown> | undefined;
      if (!delta || idx < 0) {
        continue;
      }
      const dt = typeof delta.type === "string" ? delta.type : "";
      if (dt === "text_delta" && typeof delta.text === "string") {
        const prev = textByIndex.get(idx) ?? "";
        textByIndex.set(idx, prev + delta.text);
      }
    }
  }

  const textIndices = [...textByIndex.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const i of textIndices) {
    if (blockTypes.get(i) !== "text") {
      continue;
    }
    const t = (textByIndex.get(i) ?? "").trim();
    if (t.length > 0) {
      parts.push(t);
    }
  }
  const answer = parts.length > 0 ? parts.join("\n") : null;

  if (results.length === 0) {
    log.warn("[web-search/glm] No web_search_tool_result in Anthropic SSE stream");
  }

  return { results, answer };
}
