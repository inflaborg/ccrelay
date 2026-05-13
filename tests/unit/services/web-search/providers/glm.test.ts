/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GlmSearchProvider } from "@/services/web-search/providers/glm";

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

/** Anthropic Messages SSE (`text/event-stream`) mock for GLM anthropic protocol. */
function sseEvent(event: string | undefined, dataObj: unknown): string {
  const data = JSON.stringify(dataObj);
  if (event !== undefined && event.length > 0) {
    return `event: ${event}\ndata: ${data}\n\n`;
  }
  return `data: ${data}\n\n`;
}

function mockFetchSse(sseBody: string, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error("expected text/event-stream")),
    text: () => Promise.resolve(sseBody),
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

describe("GlmSearchProvider (openai)", () => {
  const provider = new GlmSearchProvider(
    "test-key",
    "https://api.z.ai/api/coding/paas/v4/chat/completions",
    "glm-4.7",
    "openai"
  );

  it("extracts search results from web_search array", async () => {
    const mockResponse = {
      id: "req_123",
      model: "glm-4.7",
      choices: [
        {
          message: { role: "assistant", content: "根据搜索结果，今天天气..." },
          finish_reason: "stop",
        },
      ],
      web_search: [
        {
          title: "天气预报",
          link: "https://weather.com/today",
          content: "今天晴天，温度25度",
          media: "weather.com",
          refer: "ref_1",
        },
        {
          title: "北京天气",
          link: "https://weather.com/beijing",
          content: "北京今日多云",
          media: "weather.com",
          refer: "ref_2",
        },
      ],
    };

    const fetchMock = mockFetch(mockResponse);
    const result = await provider.search("今天天气怎么样");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      url: "https://weather.com/today",
      title: "天气预报",
      content: "今天晴天，温度25度",
    });
    expect(result.results[1]).toEqual({
      url: "https://weather.com/beijing",
      title: "北京天气",
      content: "北京今日多云",
    });
    expect(result.answer).toBe("根据搜索结果，今天天气...");
  });

  it("returns empty results when web_search array is missing", async () => {
    const mockResponse = {
      id: "req_123",
      model: "glm-4.7",
      choices: [
        {
          message: { role: "assistant", content: "没有搜索结果。" },
          finish_reason: "stop",
        },
      ],
    };

    mockFetch(mockResponse);
    const result = await provider.search("test query");

    expect(result.results).toHaveLength(0);
    expect(result.answer).toBe("没有搜索结果。");
  });

  it("returns null answer when choices is empty", async () => {
    const mockResponse = {
      id: "req_123",
      model: "glm-4.7",
      choices: [],
      web_search: [
        {
          title: "Result",
          link: "https://example.com",
          content: "Content",
        },
      ],
    };

    mockFetch(mockResponse);
    const result = await provider.search("test query");

    expect(result.results).toHaveLength(1);
    expect(result.answer).toBeNull();
  });

  it("throws on HTTP error", async () => {
    mockFetch({ error: "unauthorized" }, 401);

    await expect(provider.search("test query")).rejects.toThrow("GLM API returned HTTP 401");
  });

  it("sends correct openai request", async () => {
    const mockResponse = {
      id: "req_123",
      model: "glm-4.7",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      web_search: [],
    };

    const fetchMock = mockFetch(mockResponse);
    await provider.search("weather today");

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");

    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.model).toBe("glm-4.7");
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(32000);
    expect(body.messages).toEqual([{ role: "user", content: "weather today" }]);
    expect(body.tools).toEqual([
      {
        type: "web_search",
        name: "web_search",
        web_search: { enable: true, search_result: true, count: 5, search_engine: "search-prime" },
      },
    ]);

    expect(call[1].headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    });
  });

  it("handles web_search results with missing optional fields", async () => {
    const mockResponse = {
      id: "req_123",
      model: "glm-4.7",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      web_search: [{ link: "https://example.com" }, { title: "Has Title", content: "Has Content" }],
    };

    mockFetch(mockResponse);
    const result = await provider.search("test");

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ url: "https://example.com", title: "", content: "" });
    expect(result.results[1]).toEqual({
      url: "",
      title: "Has Title",
      content: "Has Content",
    });
  });
});

describe("GlmSearchProvider (anthropic)", () => {
  const provider = new GlmSearchProvider(
    "test-key",
    "https://api.z.ai/api/anthropic",
    "glm-4.7",
    "anthropic"
  );

  it("extracts results from web_search_tool_result SSE block", async () => {
    const sse = [
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "glm-4.7",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", id: "call_1", name: "web_search", input: {} },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "call_1",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/1",
              title: "Result 1",
              encrypted_content: "Content 1",
            },
            {
              type: "web_search_result",
              url: "https://example.com/2",
              title: "Result 2",
              encrypted_content: "Content 2",
            },
          ],
        },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 2,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: "Here are the results." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 2 }),
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");

    mockFetchSse(sse);
    const result = await provider.search("test query");

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      url: "https://example.com/1",
      title: "Result 1",
      content: "Content 1",
    });
    expect(result.answer).toBe("Here are the results.");
  });

  it("concatenates multiple text blocks from SSE", async () => {
    const sse = [
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "c1",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com",
              title: "Result",
              encrypted_content: "Content",
            },
          ],
        },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "Part 1." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 2,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: "Part 2." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 2 }),
    ].join("");

    mockFetchSse(sse);
    const result = await provider.search("test query");

    expect(result.answer).toBe("Part 1.\nPart 2.");
  });

  it("sends correct anthropic streaming request", async () => {
    const sse = [
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ok" },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    ].join("");

    const fetchMock = mockFetchSse(sse);
    await provider.search("weather today");

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://api.z.ai/api/anthropic/v1/messages");

    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.model).toBe("glm-4.7");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(32000);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "weather today" }] },
    ]);
    expect(body.system).toBeUndefined();
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]);

    expect(call[1].headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("extracts results from GLM tool_result SSE collapsed to web_search_tool_result", async () => {
    const toolJson = JSON.stringify([
      [
        {
          title: "Example",
          link: "https://example.com/page",
          content: "Snippet text",
          refer: "ref1",
        },
      ],
    ]);
    const sse = [
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "server_tool_use",
          id: "call_2",
          name: "web_search_prime",
          input: {},
        },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_result", tool_use_id: "call_2", content: toolJson },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 2,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: "Summary from search." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 2 }),
    ].join("");

    mockFetchSse(sse);
    const result = await provider.search("test query");

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      url: "https://example.com/page",
      title: "Example",
      content: "Snippet text",
    });
    expect(result.answer).toBe("Summary from search.");
  });

  it("returns empty results when web_search_tool_result is missing in SSE", async () => {
    const sse = [
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "No results." },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    ].join("");

    mockFetchSse(sse);
    const result = await provider.search("test");

    expect(result.results).toHaveLength(0);
    expect(result.answer).toBe("No results.");
  });
});
