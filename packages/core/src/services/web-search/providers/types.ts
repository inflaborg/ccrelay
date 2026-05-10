/** A single normalized search result, independent of provider. */
export interface NormalizedSearchResult {
  url: string;
  title: string;
  /** Search snippet / excerpt — maps to `encrypted_content` in Anthropic format. */
  content: string;
}

/** Normalized search response from any provider. */
export interface SearchProviderResponse {
  results: NormalizedSearchResult[];
  /** Pre-synthesized answer (e.g. Tavily provides this). Null if unavailable. */
  answer: string | null;
}

/** Options passed to search providers. */
export interface SearchOptions {
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  includeAnswer?: boolean;
}

/** Abstract search engine interface. */
export interface SearchProvider {
  readonly name: string;
  search(query: string, options?: SearchOptions): Promise<SearchProviderResponse>;
}
