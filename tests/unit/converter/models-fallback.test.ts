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
  rewriteModelsListPayloadInPlace,
} from "@/converter/models-fallback";

const stubProvider = {
  id: "stub",
  name: "stub",
  baseUrl: "https://x.example",
  mode: "passthrough" as const,
  providerType: "openai_chat" as const,
  headers: {},
};

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
      provider: stubProvider,
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
      provider: stubProvider,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("returns Anthropic list with has_more when truncated", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelIds: ids,
      targetUrl: "https://up.example/v1/models?limit=2",
      provider: stubProvider,
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
      provider: stubProvider,
    });
    const body = JSON.parse(raw) as { has_more: boolean };
    expect(body.has_more).toBe(false);
  });

  it("maps custom list ids through reverse modelMap targets to client patterns", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ["upstream-real"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "claude-opus-4-5", model: "upstream-real" }],
      },
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["claude-opus-4-5"]);
  });

  it("does not rewrite list id when only a catch-all * pattern maps the upstream model", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ["gpt-5.4-mini"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "*", model: "gpt-5.4-mini" }],
      },
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["gpt-5.4-mini"]);
  });

  it("leaves ids that already match a forward pattern unchanged", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ["claude-opus-4-20250514"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "claude-*", model: "glm-4" }],
      },
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["claude-opus-4-20250514"]);
  });

  it("dedupes custom list ids after they map to the same client pattern", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ["glm-a", "glm-b"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [
          { pattern: "claude-*", model: "glm-a" },
          { pattern: "claude-*", model: "glm-b" },
        ],
      },
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["claude-*"]);
  });

  it("skips reverse map for custom list when modelMappingEnabled is false", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelIds: ["upstream-real"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMappingEnabled: false,
        modelMap: [{ pattern: "claude-opus-4-5", model: "upstream-real" }],
      },
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["upstream-real"]);
  });
});

describe("rewriteModelsListPayloadInPlace", () => {
  it("rewrites OpenAI list ids from mapping targets", () => {
    const parsed = {
      object: "list",
      data: [{ id: "glm-4", object: "model", created: 1, owned_by: "x" }],
    } as unknown as Record<string, unknown>;
    const changed = rewriteModelsListPayloadInPlace(parsed, {
      ...stubProvider,
      modelMap: [{ pattern: "claude-*", model: "glm-4" }],
    });
    expect(changed).toBe(true);
    expect((parsed.data as Array<{ id: string }>)[0].id).toBe("claude-*");
  });

  it("rewrites Anthropic list id and first_id/last_id; sync display_name only when it matched id", () => {
    const parsed = {
      data: [
        { id: "glm-4", type: "model", display_name: "glm-4" },
        { id: "other", type: "model", display_name: "Nice name" },
      ],
      first_id: "glm-4",
      last_id: "other",
      has_more: false,
    } as unknown as Record<string, unknown>;
    const changed = rewriteModelsListPayloadInPlace(parsed, {
      ...stubProvider,
      modelMap: [{ pattern: "claude-*", model: "glm-4" }],
    });
    expect(changed).toBe(true);
    const data = parsed.data as Array<{ id: string; display_name: string }>;
    expect(data[0].id).toBe("claude-*");
    expect(data[0].display_name).toBe("claude-*");
    expect(data[1].id).toBe("other");
    expect(data[1].display_name).toBe("Nice name");
    expect(parsed.first_id).toBe("claude-*");
    expect(parsed.last_id).toBe("other");
  });

  it("collapses duplicate rows after mapping to the same id", () => {
    const parsed = {
      object: "list",
      data: [
        { id: "glm-a", object: "model", created: 1, owned_by: "x" },
        { id: "glm-b", object: "model", created: 2, owned_by: "x" },
      ],
    } as unknown as Record<string, unknown>;
    const changed = rewriteModelsListPayloadInPlace(parsed, {
      ...stubProvider,
      modelMap: [
        { pattern: "claude-*", model: "glm-a" },
        { pattern: "claude-*", model: "glm-b" },
      ],
    });
    expect(changed).toBe(true);
    const data = parsed.data as Array<{ id: string }>;
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("claude-*");
  });

  it("collapses duplicate Anthropic rows and fixes first_id/last_id", () => {
    const parsed = {
      data: [
        { id: "glm-a", type: "model", display_name: "glm-a" },
        { id: "glm-b", type: "model", display_name: "glm-b" },
      ],
      first_id: "glm-a",
      last_id: "glm-b",
      has_more: false,
    } as unknown as Record<string, unknown>;
    rewriteModelsListPayloadInPlace(parsed, {
      ...stubProvider,
      modelMap: [
        { pattern: "claude-*", model: "glm-a" },
        { pattern: "claude-*", model: "glm-b" },
      ],
    });
    const data = parsed.data as Array<{ id: string }>;
    expect(data.length).toBe(1);
    expect(parsed.first_id).toBe("claude-*");
    expect(parsed.last_id).toBe("claude-*");
  });

  it("does not reverse-map when modelMappingEnabled is false", () => {
    const parsed = {
      object: "list",
      data: [{ id: "glm-4", object: "model", created: 1, owned_by: "x" }],
    } as unknown as Record<string, unknown>;
    const changed = rewriteModelsListPayloadInPlace(parsed, {
      ...stubProvider,
      modelMappingEnabled: false,
      modelMap: [{ pattern: "claude-*", model: "glm-4" }],
    });
    expect(changed).toBe(false);
    expect((parsed.data as Array<{ id: string }>)[0].id).toBe("glm-4");
  });
});
