/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ParallelSearchProvider } from "@/services/web-search/providers/parallel";
import { createSearchProvider } from "@/services/web-search/providers";

function mockFetch(response: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ParallelSearchProvider", () => {
  const provider = new ParallelSearchProvider("test-parallel-key", {
    mode: "basic",
    maxResults: 5,
  });

  it("maps excerpts to content and sends correct request", async () => {
    const mockResponse = {
      search_id: "search_abc",
      results: [
        {
          url: "https://example.com/a",
          title: "Example A",
          excerpts: ["First excerpt", "Second excerpt"],
        },
        {
          url: "https://example.com/b",
          title: null,
          excerpts: ["Only excerpt"],
        },
      ],
      session_id: "session_abc",
    };

    const fetchMock = mockFetch(mockResponse);

    const result = await provider.search("weather in Tokyo");

    expect(result.answer).toBeNull();
    expect(result.results).toEqual([
      {
        url: "https://example.com/a",
        title: "Example A",
        content: "First excerpt\n\nSecond excerpt",
      },
      {
        url: "https://example.com/b",
        title: "https://example.com/b",
        content: "Only excerpt",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.parallel.ai/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "test-parallel-key",
    });

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.objective).toBe("weather in Tokyo");
    expect(body.search_queries).toEqual(["weather in Tokyo"]);
    expect(body.mode).toBe("basic");
    expect(body.advanced_settings).toEqual({ max_results: 5 });
  });

  it("returns empty results when API returns none", async () => {
    mockFetch({ search_id: "search_empty", results: [], session_id: "session_empty" });

    const result = await provider.search("nothing here");
    expect(result).toEqual({ results: [], answer: null });
  });

  it("throws on HTTP error", async () => {
    mockFetch({ error: "unauthorized" }, 401);

    await expect(provider.search("fail")).rejects.toThrow("Parallel API returned HTTP 401");
  });

  it("throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(provider.search("fail")).rejects.toThrow("network down");
  });

  it("defaults mode to basic when not configured", async () => {
    const defaultProvider = new ParallelSearchProvider("key-only");
    const fetchMock = mockFetch({
      search_id: "search_def",
      results: [],
      session_id: "session_def",
    });

    await defaultProvider.search("test query");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.mode).toBe("basic");
    expect(body.advanced_settings).toEqual({ max_results: 5 });
  });

  it("sends advanced_settings from provider defaults", async () => {
    const advancedProvider = new ParallelSearchProvider("key-advanced", {
      mode: "advanced",
      maxResults: 4,
      publishedAfter: "2024-05-01",
      location: "gb",
      includeDomains: ["gov.uk"],
      excludeDomains: ["reddit.com"],
      liveFetch: true,
      maxCharsPerResult: 15000,
    });
    const fetchMock = mockFetch({
      search_id: "search_adv",
      results: [],
      session_id: "session_adv",
    });

    await advancedProvider.search("UK policy updates");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.advanced_settings).toEqual({
      max_results: 4,
      source_policy: {
        after_date: "2024-05-01",
        include_domains: ["gov.uk"],
        exclude_domains: ["reddit.com"],
      },
      location: "gb",
      fetch_policy: { max_age_seconds: 600 },
      excerpt_settings: { max_chars_per_result: 15000 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("createSearchProvider (parallel)", () => {
  it("returns null when parallel apiKey is missing", () => {
    expect(createSearchProvider("parallel", { parallel: {} })).toBeNull();
    expect(createSearchProvider("parallel", {})).toBeNull();
  });

  it("returns ParallelSearchProvider when configured", () => {
    const p = createSearchProvider("parallel", {
      parallel: { apiKey: "pk_test", mode: "turbo", maxResults: 3 },
    });
    expect(p?.name).toBe("parallel");
  });
});
