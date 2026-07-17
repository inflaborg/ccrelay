/* eslint-disable @typescript-eslint/naming-convention */

import type { OpenAIMessage } from "@/converter/adapters/anthropic-to-openai-chat-request";
import type { AnthropicContentBlock } from "@/converter/adapters/openai-chat-to-anthropic-response";
import type { Provider } from "@/types";
import {
  applyPlatformMessageTransforms,
  applyPlatformResponseTransforms,
  glmFlattenContentTransform,
  mimoAnnotationsWebSearchResponseTransform,
  hostnameMatchesDomain,
  matchHostedToolRuleForBaseUrl,
  mimoWebSearchTransform,
  normalizeToolForProvider,
  normalizedHostnameFromBaseUrl,
  passthroughTransform,
} from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

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
    expect(r?.tools).toBeUndefined();
    expect(r?.responses).toBeUndefined();
    expect(r?.anthropicSse).toBe("glm-web-search-prime-normalize");
  });

  it("hits GLM rule for open.bigmodel.cn", () => {
    const r = matchHostedToolRuleForBaseUrl(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(r?.provider).toBe("glm");
    expect(r?.tools).toBeUndefined();
    expect(r?.responses).toBeUndefined();
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
    expect(r?.tools?.web_search).toBe("mimo-web-search");
  });

  it("hits MiniMax rule for api.minimax.io", () => {
    const r = matchHostedToolRuleForBaseUrl("https://api.minimax.io/v1/chat/completions");
    expect(r?.provider).toBe("minimax");
    expect(r?.requestSanitize).toBe("minimax-chat-sanitize");
    expect(r?.responses).toBe("minimax-reasoning-details");
  });

  it("hits MiniMax rule for api.minimaxi.com", () => {
    const r = matchHostedToolRuleForBaseUrl("https://api.minimaxi.com/v1/chat/completions");
    expect(r?.provider).toBe("minimax");
    expect(r?.requestSanitize).toBe("minimax-chat-sanitize");
    expect(r?.responses).toBe("minimax-reasoning-details");
  });

  it("hits xiaomimimo-token-plan for token-plan-sgp host (strictTools, no web_search)", () => {
    const r = matchHostedToolRuleForBaseUrl(
      "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions"
    );
    expect(r?.provider).toBe("xiaomimimo-token-plan");
    expect(r?.strictTools).toBe(true);
    expect(r?.tools).toBeUndefined();
  });

  it("hits xiaomimimo-token-plan for other xiaomimimo.com subdomains", () => {
    const r = matchHostedToolRuleForBaseUrl("https://staging.xiaomimimo.com/v1");
    expect(r?.provider).toBe("xiaomimimo-token-plan");
    expect(r?.strictTools).toBe(true);
  });

  it("hits DeepSeek rule for api.deepseek.com", () => {
    const r = matchHostedToolRuleForBaseUrl("https://api.deepseek.com/v1/chat/completions");
    expect(r?.provider).toBe("deepseek");
    expect(r?.requestSanitize).toBe("deepseek-chat-sanitize");
  });

  it("hits LongCat rule for api.longcat.chat", () => {
    const r = matchHostedToolRuleForBaseUrl("https://api.longcat.chat/anthropic/v1/messages");
    expect(r?.provider).toBe("longcat");
    expect(r?.anthropicSse).toBe("longcat-message-start-usage");
    expect(r?.anthropicSseStream).toBe(true);
  });
});

describe("normalizeToolForProvider", () => {
  it("passthrough web_search for GLM upstream (no envelope)", () => {
    expect(normalizeToolForProvider({ type: "web_search", max_uses: 2 }, GLM_BASE)).toEqual({
      type: "web_search",
      max_uses: 2,
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
});

describe("provider baseUrl drives dispatch", () => {
  it("glm base passthrough for web_search (no envelope)", () => {
    expect(
      normalizeToolForProvider({ type: "web_search" }, mockProvider("https://api.z.ai").baseUrl)
    ).toEqual({
      type: "web_search",
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

const GLM_MSG_BASE = "https://api.z.ai/api/coding/paas/v4";

describe("glmFlattenContentTransform", () => {
  it("flattens text-only array content to joined string", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ];
    const out = glmFlattenContentTransform(messages);
    expect(out).toEqual([
      { role: "system", content: "a\nb" },
      { role: "user", content: "hello" },
    ]);
    expect(messages[0].content).not.toBe(out[0].content);
  });

  it("skips empty text parts when joining", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "x" },
          { type: "text", text: "" },
          { type: "text", text: "y" },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)[0].content).toBe("x\ny");
  });

  it("leaves string content unchanged", () => {
    const messages: OpenAIMessage[] = [{ role: "assistant", content: "plain" }];
    expect(glmFlattenContentTransform(messages)).toEqual(messages);
  });

  it("preserves arrays that include non-text parts", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,xxx" },
          },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)).toEqual(messages);
  });

  it("flattens tool message when content is single text-only part array", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: [{ type: "text", text: '{"ok":true}' }],
      },
    ];
    const out = glmFlattenContentTransform(messages);
    expect(out).toEqual([{ role: "tool", tool_call_id: "tc_1", content: '{"ok":true}' }]);
  });

  it("flattens multi-part tool text content array", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "tc_1",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ];
    expect(glmFlattenContentTransform(messages)).toEqual([
      { role: "tool", tool_call_id: "tc_1", content: "part1\npart2" },
    ]);
  });
});

describe("applyPlatformMessageTransforms", () => {
  it("applies GLM flatten for api.z.ai baseUrl", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    const out = applyPlatformMessageTransforms(messages, GLM_MSG_BASE);
    expect(out).toEqual([{ role: "user", content: "q" }]);
  });

  it("applies GLM flatten for open.bigmodel.cn baseUrl", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    const out = applyPlatformMessageTransforms(messages, "https://open.bigmodel.cn/api/v1");
    expect(out).toEqual([{ role: "user", content: "q" }]);
  });

  it("is no-op for unknown upstream host", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    expect(applyPlatformMessageTransforms(messages, "https://api.example.com/v1")).toEqual(
      messages
    );
  });

  it("handles api.z.ai hostname without path", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: [{ type: "text", text: "one" }] },
    ];
    expect(applyPlatformMessageTransforms(messages, "https://API.Z.AI/")).toEqual([
      { role: "system", content: "one" },
    ]);
  });
});

describe("applyPlatformResponseTransforms", () => {
  it("GLM api.z.ai is no-op for top-level web_search (OpenAI protocol unsupported)", () => {
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "hi" }];
    const body = {
      web_search: [{ title: "x", link: "https://x", content: "c" }],
    };
    expect(applyPlatformResponseTransforms(body, blocks, "https://api.z.ai/v1/")).toBe(blocks);
  });

  it("GLM open.bigmodel.cn is no-op for top-level web_search", () => {
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "hi" }];
    const body = {
      web_search: [{ title: "x", link: "https://x" }],
    };
    expect(applyPlatformResponseTransforms(body, blocks, "https://OPEN.BIGMODEL.CN/")).toBe(blocks);
  });

  it("MiMo: no-op without message.annotations", () => {
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "hi" }];
    const body = { web_search: [{ title: "x", link: "https://x" }] };
    expect(applyPlatformResponseTransforms(body, blocks, MIMO_BASE)).toBe(blocks);
    expect(applyPlatformResponseTransforms(body, blocks, "https://api.openai.com")).toBe(blocks);
  });

  it("injects MiMo web search blocks from choices[0].message.annotations", () => {
    const annotations = [
      { type: "url_citation", url: "https://a.example", title: "A", summary: "snippet a" },
      { type: "url_citation", url: "https://b.example", title: "B" },
    ];
    const body = {
      choices: [{ message: { role: "assistant", content: "answer", annotations } }],
    };
    const prose: AnthropicContentBlock = { type: "text", text: "answer" };
    const citationDump: AnthropicContentBlock = {
      type: "text",
      text: JSON.stringify(annotations),
    };
    const blocks: AnthropicContentBlock[] = [prose, citationDump];
    const out = applyPlatformResponseTransforms(body, blocks, MIMO_BASE);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: "server_tool_use", name: "web_search" });
    expect(out[1]).toMatchObject({ type: "web_search_tool_result" });
    const tr = out[1] as { tool_use_id: string; content: unknown[] };
    expect(tr.tool_use_id).toBe((out[0] as { id: string }).id);
    expect(tr.content).toEqual([
      {
        type: "web_search_result",
        url: "https://a.example",
        title: "A",
        encrypted_content: "snippet a",
      },
      {
        type: "web_search_result",
        url: "https://b.example",
        title: "B",
      },
    ]);
    expect(out[2]).toEqual({ type: "text", text: "answer" });
  });
});

describe("mimoAnnotationsWebSearchResponseTransform", () => {
  it("returns blocks unchanged when annotations missing or empty", () => {
    const blocks: AnthropicContentBlock[] = [{ type: "text", text: "x" }];
    expect(mimoAnnotationsWebSearchResponseTransform({}, blocks)).toBe(blocks);
    expect(
      mimoAnnotationsWebSearchResponseTransform(
        { choices: [{ message: { annotations: [] } }] },
        blocks
      )
    ).toBe(blocks);
  });
});
