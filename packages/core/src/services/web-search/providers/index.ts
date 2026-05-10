import type { WebSearchGlobalConfig } from "../../../types";
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
  const name = providerName ?? "tavily";

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

  return null;
}
