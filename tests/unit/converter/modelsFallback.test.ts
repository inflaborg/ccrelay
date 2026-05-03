/* eslint-disable @typescript-eslint/naming-convention -- wire JSON uses snake_case */
import { describe, it, expect } from "vitest";
import {
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  isModelsListUpstreamPath,
  isOpenAIModelsListJson,
  isAnthropicModelsListJson,
  parseModelsListLimitFromTargetUrl,
  synthesizeCustomModelsListBody,
} from "@/converter/modelsFallback";

describe("isModelsListUpstreamPath", () => {
  it("recognizes rewritten OpenAI /models paths (query stripped)", () => {
    expect(isModelsListUpstreamPath("/models")).toBe(true);
    expect(isModelsListUpstreamPath("/v1/models")).toBe(true);
    expect(isModelsListUpstreamPath("/models?limit=1")).toBe(true);
    expect(isModelsListUpstreamPath("/chat/completions")).toBe(false);
  });
});

describe("isOpenAIModelsListJson / isAnthropicModelsListJson", () => {
  it("requires object list plus data array for OpenAI shape guard", () => {
    expect(
      isOpenAIModelsListJson({
        object: "list",
        data: [],
      })
    ).toBe(true);
    expect(isOpenAIModelsListJson({ data: [{ id: "x" }] })).toBe(false);
    expect(isOpenAIModelsListJson({ object: "foo", data: [] })).toBe(false);
  });

  it("requires data array for Anthropic minimal guard", () => {
    expect(isAnthropicModelsListJson({ data: [] })).toBe(true);
    expect(isAnthropicModelsListJson({})).toBe(false);
  });
});

describe("convertOpenAIModelsToAnthropic / convertAnthropicModelsToOpenAI", () => {
  it("converts OpenAI list to Anthropic list", () => {
    const a = convertOpenAIModelsToAnthropic({
      object: "list",
      data: [
        {
          id: "m",
          object: "model",
          created: 1,
          owned_by: "x",
        },
      ],
    });
    expect(a.data[0].id).toBe("m");
    expect(a.data[0].type).toBe("model");
    expect(a.first_id).toBe("m");
    expect(a.last_id).toBe("m");
    expect(a.has_more).toBe(false);
  });

  it("converts Anthropic list to OpenAI list", () => {
    const o = convertAnthropicModelsToOpenAI({
      data: [{ id: "n", type: "model", display_name: "N" }],
      first_id: "n",
      has_more: false,
      last_id: "n",
    });
    expect(o.object).toBe("list");
    expect(o.data[0].id).toBe("n");
    expect(o.data[0].object).toBe("model");
  });
});

describe("parseModelsListLimitFromTargetUrl", () => {
  it("parses positive integer limit from query", () => {
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=2")).toBe(2);
  });

  it("returns undefined when limit missing or invalid", () => {
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models")).toBeUndefined();
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=")).toBeUndefined();
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=0")).toBeUndefined();
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=-1")).toBeUndefined();
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=foo")).toBeUndefined();
    expect(parseModelsListLimitFromTargetUrl("https://x.com/v1/models?limit=3.5")).toBeUndefined();
  });
});

describe("synthesizeCustomModelsListBody", () => {
  const ids = ["a", "b", "c"];

  it("returns OpenAI list wire for openai surface", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ids,
      targetUrl: "https://up.example/models",
    });
    const body = JSON.parse(raw) as { object: string; data: Array<{ id: string }> };
    expect(body.object).toBe("list");
    expect(body.data.map(e => e.id)).toEqual(ids);
  });

  it("truncates with limit on OpenAI surface", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ids,
      targetUrl: "https://up.example/models?limit=2",
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("returns Anthropic list with has_more when truncated", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelIds: ids,
      targetUrl: "https://up.example/v1/models?limit=2",
    });
    const body = JSON.parse(raw) as {
      data: Array<{ id: string }>;
      has_more: boolean;
      first_id: string;
      last_id: string;
    };
    expect(body.data.map(e => e.id)).toEqual(["a", "b"]);
    expect(body.has_more).toBe(true);
    expect(body.first_id).toBe("a");
    expect(body.last_id).toBe("b");
  });

  it("has_more false when full page returned", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelIds: ids,
      targetUrl: "https://up.example/models?limit=10",
    });
    const body = JSON.parse(raw) as { has_more: boolean };
    expect(body.has_more).toBe(false);
  });
});
