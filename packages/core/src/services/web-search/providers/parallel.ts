/* eslint-disable @typescript-eslint/naming-convention -- External API wire fields */

import { Logger } from "../../../utils/logger";
import type { ParallelAdvancedConfig } from "./parallel-advanced";
import { buildParallelAdvancedSettings } from "./parallel-advanced";
import type { SearchOptions, SearchProvider, SearchProviderResponse } from "./types";

const log = Logger.getInstance();
const PARALLEL_TIMEOUT_MS = 20_000;
const PARALLEL_API_URL = "https://api.parallel.ai/v1/search";

export type ParallelSearchMode = "turbo" | "basic" | "advanced";

export interface ParallelSearchOptions extends SearchOptions, ParallelAdvancedConfig {
  mode?: ParallelSearchMode;
}

interface ParallelSearchResult {
  url: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

interface ParallelWarning {
  type?: string;
  message?: string;
}

interface ParallelResponse {
  search_id?: string;
  results?: ParallelSearchResult[];
  warnings?: ParallelWarning[] | null;
  session_id?: string;
}

export class ParallelSearchProvider implements SearchProvider {
  readonly name = "parallel";

  constructor(
    private readonly apiKey: string,
    private readonly defaultOptions?: ParallelSearchOptions
  ) {}

  async search(query: string, options?: SearchOptions): Promise<SearchProviderResponse> {
    const opts: ParallelSearchOptions = { ...this.defaultOptions, ...options };
    const mode = opts.mode ?? "basic";
    const maxResults = opts.maxResults ?? 5;

    const advancedSettings = buildParallelAdvancedSettings({
      maxResults,
      publishedAfter: opts.publishedAfter,
      location: opts.location,
      includeDomains: opts.includeDomains,
      excludeDomains: opts.excludeDomains,
      liveFetch: opts.liveFetch,
      maxCharsPerResult: opts.maxCharsPerResult,
    });

    const body: Record<string, unknown> = {
      objective: query,
      search_queries: [query],
      mode,
      ...(advancedSettings ? { advanced_settings: advancedSettings } : {}),
    };

    log.info(`[web-search/parallel] Searching: "${query}" mode=${mode}`);

    let res: Response;
    try {
      res = await fetch(PARALLEL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PARALLEL_TIMEOUT_MS),
      });
    } catch (err) {
      log.warn(
        `[web-search/parallel] Network error: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      log.warn(`[web-search/parallel] HTTP ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`Parallel API returned HTTP ${res.status}`);
    }

    const json = (await res.json()) as ParallelResponse;

    if (json.warnings && json.warnings.length > 0) {
      for (const w of json.warnings) {
        log.info(`[web-search/parallel] Warning: ${w.message ?? w.type ?? "unknown"}`);
      }
    }

    const results: SearchProviderResponse["results"] = (json.results ?? []).map(r => ({
      url: r.url,
      title: r.title ?? r.url,
      content: (r.excerpts ?? []).join("\n\n"),
    }));

    log.info(`[web-search/parallel] Got ${results.length} results`);

    return { results, answer: null };
  }
}
