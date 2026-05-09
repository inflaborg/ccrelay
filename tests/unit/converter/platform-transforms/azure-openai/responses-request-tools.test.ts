import { describe, it, expect } from "vitest";
import {
  mapAzureResponsesToolEntryForHostedWebSearch,
  sanitizeAzureResponsesRequestTools,
} from "@/converter/platform-transforms/azure-openai/responses-request-tools";

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire fixtures */

describe("sanitizeAzureResponsesRequestTools", () => {
  it("keeps only type and optional user_location on hosted web_search tools", () => {
    const req: Record<string, unknown> = {
      model: "gpt-5.4",
      tools: [
        { type: "web_search", max_uses: 8 },
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
        {
          type: "web_search",
          user_location: { type: "approximate", country: "IN" },
        },
      ],
    };
    sanitizeAzureResponsesRequestTools(req);
    expect(req.tools).toEqual([
      { type: "web_search" },
      { type: "web_search" },
      {
        type: "web_search",
        user_location: { type: "approximate", country: "IN" },
      },
    ]);
  });

  it("does not alter function tools", () => {
    const fnTool = {
      type: "function",
      name: "get_weather",
      description: "x",
      parameters: { type: "object", properties: {} },
    };
    const req: Record<string, unknown> = { tools: [fnTool] };
    sanitizeAzureResponsesRequestTools(req);
    expect(req.tools).toEqual([fnTool]);
  });
});

describe("mapAzureResponsesToolEntryForHostedWebSearch", () => {
  it("returns same object reference for non-web_search types", () => {
    const t = { type: "function", name: "a" };
    expect(mapAzureResponsesToolEntryForHostedWebSearch(t)).toBe(t);
  });
});
