import type { WebSearchConfigInput, WebSearchGlobalConfig } from "../../types";

function emptyParallelString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "auto") {
    return undefined;
  }
  return trimmed;
}

function positiveIntOrUndefined(value: number | undefined | null): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function buildWebSearchConfig(
  raw: WebSearchConfigInput | undefined
): WebSearchGlobalConfig | undefined {
  if (!raw) {
    return undefined;
  }
  const t = raw.tavily;
  const p = raw.parallel;
  const providers = Array.isArray(raw.providers) ? raw.providers : undefined;
  const defaultSearchBackend =
    typeof raw.defaultSearchBackend === "string" ? raw.defaultSearchBackend : undefined;
  const hasExplicitEnabled = typeof raw.enabled === "boolean";
  const enabled = hasExplicitEnabled ? raw.enabled === true : (providers?.length ?? 0) > 0;
  const hasContent =
    Boolean(t) ||
    Boolean(p) ||
    providers !== undefined ||
    defaultSearchBackend !== undefined ||
    hasExplicitEnabled;
  if (!hasContent) {
    return undefined;
  }

  return {
    ...(t
      ? {
          tavily: {
            apiKey: t.apiKey ?? t.api_key,
            searchDepth: t.searchDepth ?? t.search_depth,
            maxResults: t.maxResults ?? t.max_results,
          },
        }
      : {}),
    ...(p
      ? {
          parallel: {
            apiKey: p.apiKey ?? p.api_key,
            mode: p.mode,
            maxResults: p.maxResults ?? p.max_results,
            publishedAfter: emptyParallelString(p.publishedAfter ?? p.published_after),
            location: emptyParallelString(p.location),
            includeDomains: p.includeDomains ?? p.include_domains,
            excludeDomains: p.excludeDomains ?? p.exclude_domains,
            liveFetch: p.liveFetch === true || p.live_fetch === true ? true : undefined,
            maxCharsPerResult: positiveIntOrUndefined(
              p.maxCharsPerResult ?? p.max_chars_per_result
            ),
          },
        }
      : {}),
    ...(providers !== undefined ? { providers } : {}),
    ...(defaultSearchBackend ? { defaultSearchBackend } : {}),
    enabled,
  };
}
