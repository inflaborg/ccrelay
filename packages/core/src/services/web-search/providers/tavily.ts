/* eslint-disable @typescript-eslint/naming-convention -- External API wire fields */

import { Logger } from "../../../utils/logger";
import type { SearchOptions, SearchProvider, SearchProviderResponse } from "./types";

const log = Logger.getInstance();
const TAVILY_TIMEOUT_MS = 10_000;

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results?: TavilySearchResult[];
  response_time?: number;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  constructor(
    private readonly apiKey: string,
    private readonly defaultOptions?: SearchOptions
  ) {}

  async search(query: string, options?: SearchOptions): Promise<SearchProviderResponse> {
    const opts = { ...this.defaultOptions, ...options };
    const body = {
      query,
      api_key: this.apiKey,
      include_answer: opts.includeAnswer ?? true,
      search_depth: opts.searchDepth ?? "basic",
      max_results: opts.maxResults ?? 5,
    };

    log.info(`[web-search/tavily] Searching: "${query}"`);

    let res: Response;
    try {
      res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
      });
    } catch (err) {
      log.warn(
        `[web-search/tavily] Network error: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      log.warn(`[web-search/tavily] HTTP ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`Tavily API returned HTTP ${res.status}`);
    }

    const json = (await res.json()) as TavilyResponse;
    const results: SearchProviderResponse["results"] = (json.results ?? []).map(r => ({
      url: r.url,
      title: r.title,
      content: r.content,
    }));

    const answer = typeof json.answer === "string" && json.answer.length > 0 ? json.answer : null;

    log.info(`[web-search/tavily] Got ${results.length} results, answer=${answer ? "yes" : "no"}`);

    return { results, answer };
  }
}
