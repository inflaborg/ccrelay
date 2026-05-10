import type { SearchProviderResponse } from "./providers/types";

/**
 * Produce a fallback text answer when the search provider doesn't supply one.
 */
export function synthesizeAnswer(query: string, searchResult: SearchProviderResponse): string {
  if (searchResult.results.length === 0) {
    return `No web search results found for "${query}".`;
  }

  const lines: string[] = [`Based on web search results for "${query}":`];

  for (let i = 0; i < searchResult.results.length; i++) {
    const r = searchResult.results[i];
    const snippet = r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content;
    lines.push(`${i + 1}. [${r.title}](${r.url}): ${snippet}`);
  }

  return lines.join("\n");
}
