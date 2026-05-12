import type { WebSearchGlobalConfig } from "../../../types";
import { GlmSearchProvider } from "./glm";
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

  if (name === "glm") {
    const glmConfig = config.glm;
    if (!glmConfig?.apiKey || !glmConfig.endpoint) {
      return null;
    }
    return new GlmSearchProvider(
      glmConfig.apiKey,
      glmConfig.endpoint,
      glmConfig.model || undefined,
      glmConfig.protocol ?? "openai"
    );
  }

  return null;
}
