import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/naming-convention -- Parallel API wire fields */
import { buildParallelAdvancedSettings } from "@/services/web-search/providers/parallel-advanced";

describe("buildParallelAdvancedSettings", () => {
  it("returns max_results only for minimal config", () => {
    expect(buildParallelAdvancedSettings({ maxResults: 5 })).toEqual({ max_results: 5 });
  });

  it("maps source policy, location, fetch policy, and excerpt settings", () => {
    expect(
      buildParallelAdvancedSettings({
        maxResults: 3,
        publishedAfter: "2024-06-01",
        location: "us",
        includeDomains: ["arxiv.org"],
        excludeDomains: ["reddit.com"],
        liveFetch: true,
        maxCharsPerResult: 12000,
      })
    ).toEqual({
      max_results: 3,
      source_policy: {
        after_date: "2024-06-01",
        include_domains: ["arxiv.org"],
        exclude_domains: ["reddit.com"],
      },
      location: "us",
      fetch_policy: { max_age_seconds: 600 },
      excerpt_settings: { max_chars_per_result: 12000 },
    });
  });

  it("omits auto location and disabled live fetch", () => {
    expect(
      buildParallelAdvancedSettings({
        maxResults: 5,
        location: "auto",
        liveFetch: false,
      })
    ).toEqual({ max_results: 5 });
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
