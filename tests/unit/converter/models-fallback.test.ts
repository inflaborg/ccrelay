/* eslint-disable @typescript-eslint/naming-convention -- wire JSON uses snake_case */
import { describe, it, expect } from "vitest";
import {
  buildOpenAIModelsListFromIds,
  collectParsedCustomModelsDeduped,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  convertOpenAISingleModelToAnthropic,
  convertAnthropicSingleModelToOpenAI,
  extractModelIdFromDetailPath,
  isModelDetailUpstreamPath,
  isModelsListUpstreamPath,
  isOpenAIModelsListJson,
  isOpenAIModelEntryJson,
  isAnthropicModelsListJson,
  isAnthropicModelInfoJson,
  parseCustomModelLine,
  parseModelsListLimitFromTargetUrl,
  synthesizeCustomModelsListBody,
  synthesizeCustomModelDetailBody,
  synthesizeModelNotFoundBody,
  readUseModelAliasFromHeaders,
  CCRELAY_MODEL_ALIAS_HEADER,
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

describe("isModelDetailUpstreamPath / extractModelIdFromDetailPath", () => {
  it("recognizes detail paths and rejects list roots", () => {
    expect(isModelDetailUpstreamPath("/models/foo")).toBe(true);
    expect(isModelDetailUpstreamPath("/v1/models/bar")).toBe(true);
    expect(isModelDetailUpstreamPath("/models")).toBe(false);
    expect(isModelDetailUpstreamPath("/v1/models")).toBe(false);
    expect(isModelDetailUpstreamPath("/models/")).toBe(false);
  });

  it("extracts first segment and URL-decodes", () => {
    expect(extractModelIdFromDetailPath("/models/foo")).toBe("foo");
    expect(extractModelIdFromDetailPath("/v1/models/claude-3")).toBe("claude-3");
    expect(extractModelIdFromDetailPath("/models/a%2Fb")).toBe("a/b");
  });
});

describe("isOpenAIModelsListJson / isAnthropicModelsListJson / single-model guards", () => {
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

  it("detects OpenAI single model object", () => {
    expect(isOpenAIModelEntryJson({ object: "model", id: "m", created: 1, owned_by: "x" })).toBe(
      true
    );
    expect(isOpenAIModelEntryJson({ object: "list", data: [] })).toBe(false);
  });

  it("detects Anthropic single model object", () => {
    expect(
      isAnthropicModelInfoJson({
        type: "model",
        id: "m",
        display_name: "M",
        created_at: "2020-01-01T00:00:00Z",
        max_input_tokens: 0,
        max_tokens: 0,
      })
    ).toBe(true);
    expect(isAnthropicModelInfoJson({ data: [] })).toBe(false);
  });
});

describe("convertOpenAIModelsToAnthropic / convertAnthropicModelsToOpenAI", () => {
  it("converts OpenAI list to Anthropic list with scalar fields", () => {
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
    expect(a.data[0].display_name).toBe("m");
    expect(a.data[0].created_at).toBe("1970-01-01T00:00:01.000Z");
    expect(a.data[0].max_input_tokens).toBe(0);
    expect(a.data[0].max_tokens).toBe(0);
    expect(a.first_id).toBe("m");
    expect(a.last_id).toBe("m");
    expect(a.has_more).toBe(false);
  });

  it("converts Anthropic list to OpenAI list using created_at", () => {
    const o = convertAnthropicModelsToOpenAI({
      data: [
        {
          id: "n",
          type: "model",
          display_name: "N",
          created_at: "2020-06-15T12:00:00Z",
          max_input_tokens: 100,
          max_tokens: 50,
        },
      ],
      first_id: "n",
      has_more: false,
      last_id: "n",
    });
    expect(o.object).toBe("list");
    expect(o.data[0].id).toBe("n");
    expect(o.data[0].object).toBe("model");
    expect(o.data[0].created).toBe(Math.floor(new Date("2020-06-15T12:00:00Z").getTime() / 1000));
    expect(o.data[0].display_name).toBe("N");
  });

  it("uses OpenAI display_name when present on entries", () => {
    const a = convertOpenAIModelsToAnthropic({
      object: "list",
      data: [
        {
          id: "x",
          object: "model",
          created: 1,
          owned_by: "o",
          display_name: "Shown",
        },
      ],
    });
    expect(a.data[0].display_name).toBe("Shown");
  });

  it("preserves display_name on OpenAI entries when same as id", () => {
    const o = convertAnthropicModelsToOpenAI({
      data: [
        {
          id: "same",
          type: "model",
          display_name: "same",
          created_at: "2021-01-01T00:00:00Z",
          max_input_tokens: 0,
          max_tokens: 0,
        },
      ],
      first_id: "same",
      has_more: false,
      last_id: "same",
    });
    expect(o.data[0].display_name).toBeUndefined();
  });
});

describe("convertOpenAISingleModelToAnthropic / convertAnthropicSingleModelToOpenAI", () => {
  it("round-trips single model shapes", () => {
    const openai = {
      id: "gpt-x",
      object: "model" as const,
      created: 1700000000,
      owned_by: "openai",
      display_name: "GPT X",
    };
    const anth = convertOpenAISingleModelToAnthropic(openai);
    expect(anth.id).toBe("gpt-x");
    expect(anth.display_name).toBe("GPT X");
    expect(anth.max_input_tokens).toBe(0);
    const back = convertAnthropicSingleModelToOpenAI(anth);
    expect(back.id).toBe("gpt-x");
    expect(back.display_name).toBe("GPT X");
  });
});

describe("parseCustomModelLine / collectParsedCustomModelsDeduped", () => {
  it("parses no semicolon as id equals display and alias", () => {
    expect(parseCustomModelLine("  foo  ")).toEqual({
      id: "foo",
      displayName: "foo",
      alias: "foo",
    });
  });

  it("parses two segments as real id, display, alias defaults to id", () => {
    expect(parseCustomModelLine("a;b")).toEqual({ id: "a", displayName: "b", alias: "a" });
  });

  it("parses three segments as real id, display, alias", () => {
    expect(parseCustomModelLine("a;b;c")).toEqual({ id: "a", displayName: "b", alias: "c" });
    expect(parseCustomModelLine("a;b;c;d")).toEqual({ id: "a", displayName: "b", alias: "c;d" });
  });

  it("parses double semicolon as display falls back to id", () => {
    expect(parseCustomModelLine("a;;c")).toEqual({ id: "a", displayName: "a", alias: "c" });
  });

  it("falls back display to id when right side empty after one semicolon", () => {
    expect(parseCustomModelLine("a;")).toEqual({ id: "a", displayName: "a", alias: "a" });
    expect(parseCustomModelLine("a;  ")).toEqual({ id: "a", displayName: "a", alias: "a" });
  });

  it("dedupes by parsed id keeping first line", () => {
    expect(collectParsedCustomModelsDeduped(["a;One", "a;Two", "b"])).toEqual([
      { id: "a", displayName: "One", alias: "a" },
      { id: "b", displayName: "b", alias: "b" },
    ]);
  });
});

describe("buildOpenAIModelsListFromIds", () => {
  it("parses semicolon lines and omits display_name when same as wire id", () => {
    const o = buildOpenAIModelsListFromIds(["m", "n;Name"], false);
    expect(o.data.map(e => e.id)).toEqual(["m", "n"]);
    expect(o.data[1].display_name).toBe("Name");
    expect(o.data[0].display_name).toBeUndefined();
  });

  it("uses alias as wire id when useAlias is true", () => {
    const o = buildOpenAIModelsListFromIds(["glm-5;GLM 5;claude-x"], true);
    expect(o.data[0].id).toBe("claude-x");
    expect(o.data[0].display_name).toBe("GLM 5");
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
      fullModelLines: ids,
      targetUrl: "https://up.example/models",
      provider: stubProvider,
      useAlias: false,
    });
    const body = JSON.parse(raw) as { object: string; data: Array<{ id: string }> };
    expect(body.object).toBe("list");
    expect(body.data.map(e => e.id)).toEqual(ids);
  });

  it("truncates with limit on OpenAI surface", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ids,
      targetUrl: "https://up.example/models?limit=2",
      provider: stubProvider,
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("returns Anthropic list with has_more when truncated", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelLines: ids,
      targetUrl: "https://up.example/v1/models?limit=2",
      provider: stubProvider,
      useAlias: false,
    });
    const body = JSON.parse(raw) as {
      data: Array<{ id: string; created_at: string; max_input_tokens: number; max_tokens: number }>;
      has_more: boolean;
      first_id: string;
      last_id: string;
    };
    expect(body.data.map(e => e.id)).toEqual(["a", "b"]);
    expect(body.has_more).toBe(true);
    expect(body.first_id).toBe("a");
    expect(body.last_id).toBe("b");
    expect(typeof body.data[0].created_at).toBe("string");
    expect(body.data[0].max_input_tokens).toBe(0);
    expect(body.data[0].max_tokens).toBe(0);
  });

  it("has_more false when full page returned", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelLines: ids,
      targetUrl: "https://up.example/models?limit=10",
      provider: stubProvider,
      useAlias: false,
    });
    const body = JSON.parse(raw) as { has_more: boolean };
    expect(body.has_more).toBe(false);
  });

  it("does not apply modelMap to custom list ids", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ["upstream-real"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "claude-opus-4-5", model: "upstream-real" }],
      },
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["upstream-real"]);
  });

  it("does not rewrite list id when only a catch-all * pattern maps the upstream model", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ["gpt-5.4-mini"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "*", model: "gpt-5.4-mini" }],
      },
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["gpt-5.4-mini"]);
  });

  it("preserves distinct custom list ids when modelMap has catch-all", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelLines: ["gpt-5.4", "gpt-5.4-mini"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "*", model: "gpt-5.4" }],
      },
      useAlias: false,
    });
    const body = JSON.parse(raw) as {
      data: Array<{ id: string }>;
      first_id: string;
      last_id: string;
    };
    expect(body.data.map(e => e.id)).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(body.first_id).toBe("gpt-5.4");
    expect(body.last_id).toBe("gpt-5.4-mini");
  });

  it("leaves ids that already match a forward pattern unchanged", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ["claude-opus-4-20250514"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [{ pattern: "claude-*", model: "glm-4" }],
      },
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["claude-opus-4-20250514"]);
  });

  it("does not collapse custom list ids that only share modelMap patterns", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ["glm-a", "glm-b"],
      targetUrl: "https://up.example/models",
      provider: {
        ...stubProvider,
        modelMap: [
          { pattern: "claude-*", model: "glm-a" },
          { pattern: "claude-*", model: "glm-b" },
        ],
      },
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string }> };
    expect(body.data.map(e => e.id)).toEqual(["glm-a", "glm-b"]);
  });

  it("maps semicolon lines to Anthropic display_name", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "anthropic",
      fullModelLines: ["a;Alpha", "b", "c;Gamma"],
      targetUrl: "https://up.example/models",
      provider: stubProvider,
      useAlias: false,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string; display_name: string }> };
    expect(body.data.map(e => e.id)).toEqual(["a", "b", "c"]);
    expect(body.data.map(e => e.display_name)).toEqual(["Alpha", "b", "Gamma"]);
  });

  it("returns alias wire ids when useAlias is true", () => {
    const raw = synthesizeCustomModelsListBody({
      clientSurface: "openai",
      fullModelLines: ["glm-5.1;GLM 5.1;claude-a1", "glm-4.7;;claude-a2"],
      targetUrl: "https://up.example/models",
      provider: stubProvider,
      useAlias: true,
    });
    const body = JSON.parse(raw) as { data: Array<{ id: string; display_name?: string }> };
    expect(body.data.map(e => e.id)).toEqual(["claude-a1", "claude-a2"]);
    expect(body.data[0].display_name).toBe("GLM 5.1");
    expect(body.data[1].display_name).toBe("glm-4.7");
  });
});

describe("synthesizeCustomModelDetailBody / synthesizeModelNotFoundBody", () => {
  it("returns Anthropic ModelInfo when found", () => {
    const raw = synthesizeCustomModelDetailBody({
      clientSurface: "anthropic",
      modelId: "a",
      fullModelLines: ["a;Alpha", "b"],
      useAlias: false,
    });
    expect(raw).not.toBeNull();
    const body = JSON.parse(raw as string) as {
      id: string;
      type: string;
      display_name: string;
      created_at: string;
      max_input_tokens: number;
      max_tokens: number;
    };
    expect(body.id).toBe("a");
    expect(body.type).toBe("model");
    expect(body.display_name).toBe("Alpha");
    expect(body.max_input_tokens).toBe(0);
    expect(body.max_tokens).toBe(0);
  });

  it("returns OpenAI model object when found", () => {
    const raw = synthesizeCustomModelDetailBody({
      clientSurface: "openai",
      modelId: "b",
      fullModelLines: ["a", "b;Bee"],
      useAlias: false,
    });
    expect(raw).not.toBeNull();
    const body = JSON.parse(raw as string) as { id: string; object: string; display_name?: string };
    expect(body.id).toBe("b");
    expect(body.object).toBe("model");
    expect(body.display_name).toBe("Bee");
  });

  it("returns null when id missing from list", () => {
    expect(
      synthesizeCustomModelDetailBody({
        clientSurface: "anthropic",
        modelId: "missing",
        fullModelLines: ["a"],
        useAlias: false,
      })
    ).toBeNull();
  });

  it("resolves detail by alias when useAlias is true", () => {
    const raw = synthesizeCustomModelDetailBody({
      clientSurface: "anthropic",
      modelId: "claude-z",
      fullModelLines: ["glm-5;GLM Five;claude-z"],
      useAlias: true,
    });
    expect(raw).not.toBeNull();
    const body = JSON.parse(raw as string) as { id: string; display_name: string };
    expect(body.id).toBe("claude-z");
    expect(body.display_name).toBe("GLM Five");
  });

  it("emits anthropic-shaped not_found JSON", () => {
    const s = synthesizeModelNotFoundBody("anthropic", "x");
    const j = JSON.parse(s) as { type: string; error: { type: string } };
    expect(j.type).toBe("error");
    expect(j.error.type).toBe("not_found_error");
  });
});

describe("readUseModelAliasFromHeaders", () => {
  it("header constant matches wire name", () => {
    expect(CCRELAY_MODEL_ALIAS_HEADER).toBe("x-ccrelay-model-alias");
  });

  it("returns false when header missing", () => {
    expect(readUseModelAliasFromHeaders({})).toBe(false);
  });

  it("returns true for typical truthy values", () => {
    expect(readUseModelAliasFromHeaders({ "x-ccrelay-model-alias": "true" })).toBe(true);
    expect(readUseModelAliasFromHeaders({ "X-CCRelay-Model-Alias": "1" })).toBe(true);
  });

  it("returns false for false, 0, no, empty", () => {
    expect(readUseModelAliasFromHeaders({ "x-ccrelay-model-alias": "false" })).toBe(false);
    expect(readUseModelAliasFromHeaders({ "x-ccrelay-model-alias": "0" })).toBe(false);
    expect(readUseModelAliasFromHeaders({ "x-ccrelay-model-alias": "no" })).toBe(false);
    expect(readUseModelAliasFromHeaders({ "x-ccrelay-model-alias": "  " })).toBe(false);
  });
});
