import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/naming-convention -- YAML snake_case parity */
import { buildWebSearchConfig } from "@/config/builders/web-search";

describe("buildWebSearchConfig", () => {
  it("returns undefined for empty input", () => {
    expect(buildWebSearchConfig(undefined)).toBeUndefined();
  });

  it("returns undefined when no meaningful keys", () => {
    expect(buildWebSearchConfig({})).toBeUndefined();
  });

  it("normalizes tavily snake_case", () => {
    const c = buildWebSearchConfig({
      tavily: { api_key: "k", search_depth: "advanced", max_results: 5 },
    });
    expect(c?.tavily).toEqual({
      apiKey: "k",
      searchDepth: "advanced",
      maxResults: 5,
    });
  });

  it("includes providers and defaultSearchBackend", () => {
    const c = buildWebSearchConfig({
      providers: ["a", "b"],
      defaultSearchBackend: "parallel",
    });
    expect(c?.providers).toEqual(["a", "b"]);
    expect(c?.defaultSearchBackend).toBe("parallel");
    expect(c?.enabled).toBe(true);
  });

  it("preserves providers when enabled is false", () => {
    const c = buildWebSearchConfig({
      enabled: false,
      providers: ["a", "b"],
      defaultSearchBackend: "tavily",
    });
    expect(c?.enabled).toBe(false);
    expect(c?.providers).toEqual(["a", "b"]);
  });

  it("legacy config without enabled uses non-empty providers as on", () => {
    expect(buildWebSearchConfig({ providers: ["x"] })?.enabled).toBe(true);
    expect(buildWebSearchConfig({ providers: [] })?.enabled).toBe(false);
  });

  it("normalizes parallel snake_case", () => {
    const c = buildWebSearchConfig({
      parallel: { api_key: "pk_test", mode: "turbo", max_results: 3 },
    });
    expect(c?.parallel).toEqual({
      apiKey: "pk_test",
      mode: "turbo",
      maxResults: 3,
    });
    expect(c?.enabled).toBe(false);
  });

  it("accepts defaultSearchBackend parallel", () => {
    const c = buildWebSearchConfig({
      parallel: { apiKey: "pk_test" },
      defaultSearchBackend: "parallel",
    });
    expect(c?.defaultSearchBackend).toBe("parallel");
    expect(c?.parallel?.apiKey).toBe("pk_test");
  });

  it("normalizes parallel advanced fields and clears empty strings", () => {
    const c = buildWebSearchConfig({
      parallel: {
        api_key: "pk_test",
        published_after: "2024-01-01",
        include_domains: ["arxiv.org"],
        exclude_domains: [],
        live_fetch: true,
        max_chars_per_result: 8000,
        location: "",
      },
    });
    expect(c?.parallel).toEqual({
      apiKey: "pk_test",
      publishedAfter: "2024-01-01",
      includeDomains: ["arxiv.org"],
      excludeDomains: [],
      liveFetch: true,
      maxCharsPerResult: 8000,
    });
    expect(c?.parallel?.location).toBeUndefined();
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
