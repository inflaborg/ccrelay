/* eslint-disable @typescript-eslint/naming-convention -- External API wire fields */

/** Runtime options for Parallel Search `advanced_settings`. */
export interface ParallelAdvancedConfig {
  maxResults?: number;
  publishedAfter?: string;
  location?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  liveFetch?: boolean;
  maxCharsPerResult?: number;
}

export function buildParallelAdvancedSettings(
  config: ParallelAdvancedConfig
): Record<string, unknown> | undefined {
  const advanced: Record<string, unknown> = {};

  if (typeof config.maxResults === "number") {
    advanced.max_results = config.maxResults;
  }

  const sourcePolicy: Record<string, unknown> = {};
  if (config.publishedAfter) {
    sourcePolicy.after_date = config.publishedAfter;
  }
  if (config.includeDomains && config.includeDomains.length > 0) {
    sourcePolicy.include_domains = config.includeDomains;
  }
  if (config.excludeDomains && config.excludeDomains.length > 0) {
    sourcePolicy.exclude_domains = config.excludeDomains;
  }
  if (Object.keys(sourcePolicy).length > 0) {
    advanced.source_policy = sourcePolicy;
  }

  if (config.location && config.location !== "auto") {
    advanced.location = config.location;
  }

  if (config.liveFetch === true) {
    advanced.fetch_policy = { max_age_seconds: 600 };
  }

  if (typeof config.maxCharsPerResult === "number" && config.maxCharsPerResult > 0) {
    advanced.excerpt_settings = { max_chars_per_result: config.maxCharsPerResult };
  }

  return Object.keys(advanced).length > 0 ? advanced : undefined;
}
