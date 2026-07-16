import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/naming-convention -- YAML snake_case parity */
import { buildWebSearchConfig, computeGlmEndpoint } from "@/config/builders/web-search";

describe("computeGlmEndpoint", () => {
  it("intl anthropic", () => {
    expect(computeGlmEndpoint("anthropic", "intl", false)).toBe("https://api.z.ai/api/anthropic");
  });

  it("cn anthropic", () => {
    expect(computeGlmEndpoint("anthropic", "cn", false)).toBe(
      "https://open.bigmodel.cn/api/anthropic"
    );
  });

  it("intl openai without coding", () => {
    expect(computeGlmEndpoint("openai", "intl", false)).toBe(
      "https://api.z.ai/api/paas/v4/chat/completions"
    );
  });

  it("intl openai with coding", () => {
    expect(computeGlmEndpoint("openai", "intl", true)).toBe(
      "https://api.z.ai/api/coding/paas/v4/chat/completions"
    );
  });
});

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

  it("computes glm endpoint when omitted", () => {
    const c = buildWebSearchConfig({
      glm: { api_key: "x", protocol: "anthropic", region: "cn", coding: true },
    });
    expect(c?.glm?.apiKey).toBe("x");
    expect(c?.glm?.endpoint).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(c?.glm?.protocol).toBe("anthropic");
    expect(c?.glm?.region).toBe("cn");
    expect(c?.glm?.coding).toBe(true);
  });

  it("keeps explicit glm endpoint", () => {
    const c = buildWebSearchConfig({
      glm: { apiKey: "x", endpoint: "https://custom.example/v1" },
    });
    expect(c?.glm?.endpoint).toBe("https://custom.example/v1");
  });

  it("includes providers and defaultSearchBackend", () => {
    const c = buildWebSearchConfig({
      providers: ["a", "b"],
      defaultSearchBackend: "glm",
    });
    expect(c?.providers).toEqual(["a", "b"]);
    expect(c?.defaultSearchBackend).toBe("glm");
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
});
/* eslint-enable @typescript-eslint/naming-convention */
