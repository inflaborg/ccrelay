/* eslint-disable @typescript-eslint/naming-convention -- wire tool payload keys */

import { describe, it, expect } from "vitest";
import {
  normalizeToolForProvider,
  anthropicServerToolDefToOpenAIHosted,
} from "@/converter/tool-schema-conversion";

const GLM_BASE = "https://api.z.ai/";
const PASSTHROUGH_BASE = "https://api.openai.com/v1";

describe("normalizeToolForProvider (re-export)", () => {
  it("passthrough upstream keeps flat web_search", () => {
    expect(normalizeToolForProvider({ type: "web_search", max_uses: 2 }, PASSTHROUGH_BASE)).toEqual(
      {
        type: "web_search",
        max_uses: 2,
      }
    );
  });

  it("GLM upstream injects web_search envelope", () => {
    expect(normalizeToolForProvider({ type: "web_search", max_uses: 2 }, GLM_BASE)).toEqual({
      type: "web_search",
      web_search: {
        enable: true,
        max_uses: 2,
        search_engine: "search-prime",
        search_result: true,
      },
    });
  });

  it("GLM upstream fixes web_search: null", () => {
    expect(
      normalizeToolForProvider({ type: "web_search", web_search: null, foo: 1 }, GLM_BASE)
    ).toEqual({
      type: "web_search",
      foo: 1,
      web_search: { enable: true, search_engine: "search-prime", search_result: true },
    });
  });

  it("GLM merges Chat web-search defaults into an existing envelope", () => {
    const input = { type: "web_search", web_search: { enable: "True" } };
    expect(normalizeToolForProvider(input, GLM_BASE)).toEqual({
      type: "web_search",
      web_search: { enable: true, search_engine: "search-prime", search_result: true },
    });
  });

  it("GLM hoists flat Z.ai-style keys into nested web_search", () => {
    expect(
      normalizeToolForProvider(
        {
          type: "web_search",
          search_engine: "search_pro",
          count: "5",
          search_prompt: "Summarize: {{search_result}}",
        },
        GLM_BASE
      )
    ).toEqual({
      type: "web_search",
      web_search: {
        enable: true,
        search_engine: "search_pro",
        search_result: true,
        count: "5",
        search_prompt: "Summarize: {{search_result}}",
      },
    });
  });
});

describe("anthropicServerToolDefToOpenAIHosted", () => {
  const tool = {
    type: "web_search_20250305" as const,
    name: "web_search",
    max_uses: 9,
  };

  it("unknown upstream preserves max_uses on surface", () => {
    expect(anthropicServerToolDefToOpenAIHosted(tool, PASSTHROUGH_BASE)).toEqual({
      type: "web_search",
      max_uses: 9,
    });
  });

  it("GLM upstream nests web_search envelope", () => {
    expect(anthropicServerToolDefToOpenAIHosted(tool, GLM_BASE)).toEqual({
      type: "web_search",
      web_search: {
        enable: true,
        max_uses: 9,
        search_engine: "search-prime",
        search_result: true,
      },
    });
  });
});
