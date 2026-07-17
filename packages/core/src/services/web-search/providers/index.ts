import type { WebSearchGlobalConfig } from "../../../types";
import { ParallelSearchProvider } from "./parallel";
import { TavilySearchProvider } from "./tavily";
import type { SearchProvider } from "./types";

export type {
  NormalizedSearchResult,
  SearchProviderResponse,
  SearchOptions,
  SearchProvider,
} from "./types";

export type { WebSearchGlobalConfig } from "../../../types";

export function createSearchProvider(
  providerName: string | undefined,
  config: WebSearchGlobalConfig
): SearchProvider | null {
  const name = providerName ?? config.defaultSearchBackend ?? "tavily";

  if (name === "tavily") {
    const tavilyConfig = config.tavily;
    if (!tavilyConfig?.apiKey) {
      return null;
    }
    return new TavilySearchProvider(tavilyConfig.apiKey, {
      searchDepth: tavilyConfig.searchDepth,
      maxResults: tavilyConfig.maxResults,
    });
  }

  if (name === "parallel") {
    const parallelConfig = config.parallel;
    if (!parallelConfig?.apiKey) {
      return null;
    }
    return new ParallelSearchProvider(parallelConfig.apiKey, {
      mode: parallelConfig.mode,
      maxResults: parallelConfig.maxResults,
      publishedAfter: parallelConfig.publishedAfter,
      location: parallelConfig.location,
      includeDomains: parallelConfig.includeDomains,
      excludeDomains: parallelConfig.excludeDomains,
      liveFetch: parallelConfig.liveFetch,
      maxCharsPerResult: parallelConfig.maxCharsPerResult,
    });
  }

  return null;
}
