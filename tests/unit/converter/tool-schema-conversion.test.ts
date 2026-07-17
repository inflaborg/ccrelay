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

  it("GLM upstream passthrough for web_search (no envelope)", () => {
    expect(normalizeToolForProvider({ type: "web_search", max_uses: 2 }, GLM_BASE)).toEqual({
      type: "web_search",
      max_uses: 2,
    });
  });

  it("GLM upstream passthrough when web_search is null", () => {
    expect(
      normalizeToolForProvider({ type: "web_search", web_search: null, foo: 1 }, GLM_BASE)
    ).toEqual({
      type: "web_search",
      foo: 1,
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

  it("GLM upstream passthrough for hosted web_search", () => {
    expect(anthropicServerToolDefToOpenAIHosted(tool, GLM_BASE)).toEqual({
      type: "web_search",
      max_uses: 9,
    });
  });
});
