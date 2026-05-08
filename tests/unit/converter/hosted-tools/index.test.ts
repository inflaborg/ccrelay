/* eslint-disable @typescript-eslint/naming-convention */

import type { Provider } from "@/types";
import { describe, expect, it } from "vitest";
import {
  normalizeToolForProvider,
  normalizedHostnameFromBaseUrl,
  hostnameMatchesDomain,
  matchHostedToolRuleForBaseUrl,
  glmWebSearchEnvelopeTransform,
  mimoWebSearchTransform,
  passthroughTransform,
} from "@/converter/hosted-tools";

const GLM_BASE = "https://api.z.ai/v1/chat/completions";
const MIMO_BASE = "https://api.xiaomimimo.com/v1/chat/completions";

function mockProvider(baseUrl: string): Provider {
  return {
    id: "p",
    name: "p",
    baseUrl,
    mode: "passthrough",
    providerType: "openai_chat",
    authHeader: "authorization",
  };
}

describe("normalizedHostnameFromBaseUrl", () => {
  it("parses HTTPS URLs", () => {
    expect(normalizedHostnameFromBaseUrl("https://api.z.ai/api/v4")).toBe("api.z.ai");
    expect(normalizedHostnameFromBaseUrl("https://open.bigmodel.cn/v1")).toBe("open.bigmodel.cn");
  });

  it("prepends HTTPS when scheme is omitted", () => {
    expect(normalizedHostnameFromBaseUrl("api.xiaomimimo.com/v1")).toBe("api.xiaomimimo.com");
  });

  it("handles trailing slashes and paths", () => {
    expect(normalizedHostnameFromBaseUrl("https://FOO.example.COM/chat/")).toBe("foo.example.com");
  });

  it("returns undefined on empty input", () => {
    expect(normalizedHostnameFromBaseUrl("   ")).toBeUndefined();
  });

  it("returns undefined when URL parse fails", () => {
    expect(normalizedHostnameFromBaseUrl("://bad")).toBeUndefined();
  });
});

describe("hostnameMatchesDomain", () => {
  it("matches exact host (case-insensitive)", () => {
    expect(hostnameMatchesDomain("api.z.ai", "api.z.ai")).toBe(true);
    expect(hostnameMatchesDomain("API.Z.AI", "api.z.ai")).toBe(true);
  });

  it("does not match subdomain or partial host", () => {
    expect(hostnameMatchesDomain("staging.api.z.ai", "api.z.ai")).toBe(false);
    expect(hostnameMatchesDomain("evilnotz.ai", "api.z.ai")).toBe(false);
  });
});

describe("matchHostedToolRuleForBaseUrl", () => {
  it("hits GLM rule for api.z.ai", () => {
    const r = matchHostedToolRuleForBaseUrl(GLM_BASE);
    expect(r?.provider).toBe("glm");
    expect(r?.tools.web_search).toBe("glm-web-search-envelope");
  });

  it("hits GLM rule for open.bigmodel.cn", () => {
    const r = matchHostedToolRuleForBaseUrl(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(r?.provider).toBe("glm");
    expect(r?.tools.web_search).toBe("glm-web-search-envelope");
  });

  it("returns undefined for unrelated providers", () => {
    expect(matchHostedToolRuleForBaseUrl("https://api.openai.com/v1")).toBeUndefined();
  });

  it("does not match GLM for other *.z.ai hosts (glm uses api.z.ai only among z.ai)", () => {
    expect(matchHostedToolRuleForBaseUrl("https://chat.z.ai/v1")).toBeUndefined();
  });

  it("does not match GLM for subdomains of api.z.ai", () => {
    expect(matchHostedToolRuleForBaseUrl("https://v1.api.z.ai/v1")).toBeUndefined();
  });

  it("does not match GLM for subdomains of open.bigmodel.cn", () => {
    expect(matchHostedToolRuleForBaseUrl("https://api.open.bigmodel.cn/v1")).toBeUndefined();
  });

  it("hits MiMo rule for api.xiaomimimo.com", () => {
    const r = matchHostedToolRuleForBaseUrl(MIMO_BASE);
    expect(r?.provider).toBe("xiaomimimo");
    expect(r?.tools.web_search).toBe("mimo-web-search");
  });

  it("does not match MiMo for token-plan-sgp host (no web_search)", () => {
    expect(
      matchHostedToolRuleForBaseUrl("https://token-plan-sgp.xiaomimimo.com/v1/chat/completions")
    ).toBeUndefined();
  });

  it("does not match MiMo for other xiaomimimo.com hosts", () => {
    expect(matchHostedToolRuleForBaseUrl("https://staging.xiaomimimo.com/v1")).toBeUndefined();
  });
});

describe("normalizeToolForProvider", () => {
  it("nested web_search envelope for GLM upstream", () => {
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

  it("passthrough web_search for non-api.z.ai z.ai host", () => {
    expect(
      normalizeToolForProvider({ type: "web_search", max_uses: 2 }, "https://console.z.ai/v1")
    ).toEqual({
      type: "web_search",
      max_uses: 2,
    });
  });

  it("passthrough preserves flat web_search for unknown upstream", () => {
    expect(
      normalizeToolForProvider({ type: "web_search", max_uses: 2 }, "https://api.openai.com/v1")
    ).toEqual({
      type: "web_search",
      max_uses: 2,
    });
  });

  it("strips invalid web_search for unknown upstream", () => {
    expect(
      normalizeToolForProvider(
        { type: "web_search", web_search: null, foo: 1 },
        "https://api.example.com/"
      )
    ).toEqual({ type: "web_search", foo: 1 });
  });

  it("MiMo upstream maps max_uses to max_keyword and fills missing slots", () => {
    expect(normalizeToolForProvider({ type: "web_search", max_uses: 8 }, MIMO_BASE)).toEqual({
      type: "web_search",
      max_uses: 8,
      max_keyword: 8,
      force_search: true,
      limit: 1,
    });
  });

  it("MiMo upstream prefers max_keyword over max_uses and drops user_location", () => {
    expect(
      normalizeToolForProvider(
        {
          type: "web_search",
          max_keyword: 5,
          force_search: false,
          user_location: { type: "approximate", country: "China" },
          max_uses: 1,
        },
        MIMO_BASE
      )
    ).toEqual({
      type: "web_search",
      max_keyword: 5,
      force_search: false,
      max_uses: 1,
      limit: 1,
    });
  });

  it("preserves MiMo-style flat web_search on unrelated host (no MiMo rule)", () => {
    expect(
      normalizeToolForProvider(
        {
          type: "web_search",
          max_keyword: 3,
          force_search: true,
          limit: 1,
          user_location: { type: "approximate", country: "China" },
        },
        "https://api.example.com/"
      )
    ).toEqual({
      type: "web_search",
      max_keyword: 3,
      force_search: true,
      limit: 1,
      user_location: { type: "approximate", country: "China" },
    });
  });
});

describe("transforms", () => {
  it("passthroughTransform behaves for web_search", () => {
    expect(passthroughTransform({ type: "web_search", max_uses: 1 })).toEqual({
      type: "web_search",
      max_uses: 1,
    });
  });

  it("mimoWebSearchTransform maps max_uses to max_keyword and passthrough extras", () => {
    expect(mimoWebSearchTransform({ type: "web_search", max_uses: 8 })).toEqual({
      type: "web_search",
      max_uses: 8,
      max_keyword: 8,
      force_search: true,
      limit: 1,
    });
  });

  it("mimoWebSearchTransform accepts max_users alias for max_keyword", () => {
    expect(mimoWebSearchTransform({ type: "web_search", max_users: 7 })).toEqual({
      type: "web_search",
      max_users: 7,
      max_keyword: 7,
      force_search: true,
      limit: 1,
    });
  });

  it("mimoWebSearchTransform strips invalid envelope and keeps unknown keys", () => {
    expect(
      mimoWebSearchTransform({ type: "web_search", web_search: null, max_uses: 2, foo: "bar" })
    ).toEqual({
      type: "web_search",
      max_uses: 2,
      max_keyword: 2,
      force_search: true,
      limit: 1,
      foo: "bar",
    });
  });

  it("mimoWebSearchTransform removes user_location even when provided", () => {
    expect(
      mimoWebSearchTransform({
        type: "web_search",
        user_location: {
          type: "approximate",
          country: "China",
          region: "Hubei",
          city: "Wuhan",
        },
        custom: 1,
      })
    ).toEqual({
      type: "web_search",
      custom: 1,
      max_keyword: 3,
      force_search: true,
      limit: 1,
    });
  });

  it("mimoWebSearchTransform passthrough for non-web_search", () => {
    expect(mimoWebSearchTransform({ type: "function", name: "x" })).toEqual({
      type: "function",
      name: "x",
    });
  });

  it("glmWebSearchEnvelope wraps web_search only", () => {
    expect(glmWebSearchEnvelopeTransform({ type: "web_search", max_uses: 7 })).toEqual({
      type: "web_search",
      web_search: {
        enable: true,
        max_uses: 7,
        search_engine: "search-prime",
        search_result: true,
      },
    });
    expect(glmWebSearchEnvelopeTransform({ type: "other" })).toEqual({ type: "other" });
  });

  it("glmWebSearchEnvelope preserves unknown top-level keys beside nested envelope", () => {
    expect(
      glmWebSearchEnvelopeTransform({
        type: "web_search",
        max_uses: 2,
        foo: "bar",
        web_search: { search_engine: "search_pro" },
      })
    ).toEqual({
      type: "web_search",
      foo: "bar",
      web_search: {
        enable: true,
        max_uses: 2,
        search_engine: "search_pro",
        search_result: true,
      },
    });
  });
});

describe("provider baseUrl drives dispatch", () => {
  it("glm base implies nested envelope", () => {
    expect(
      normalizeToolForProvider({ type: "web_search" }, mockProvider("https://api.z.ai").baseUrl)
    ).toEqual({
      type: "web_search",
      web_search: { enable: true, search_engine: "search-prime", search_result: true },
    });
  });

  it("MiMo base fills defaults for bare web_search", () => {
    expect(
      normalizeToolForProvider({ type: "web_search" }, mockProvider(MIMO_BASE).baseUrl)
    ).toEqual({
      type: "web_search",
      max_keyword: 3,
      force_search: true,
      limit: 1,
    });
  });
});
