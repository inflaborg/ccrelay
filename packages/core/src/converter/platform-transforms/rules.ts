/**
 * Layer 1: declarative hostname → platform transforms (tools, messages, responses).
 * Provider implementations live under `glm/`, `xiaomimimo/`.
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire tool.type literals */

export interface PlatformTransformRule {
  provider: string;
  domains: readonly string[];
  /** Chat `tools[].type` → tool transform registry key. */
  tools?: Readonly<Record<string, string>>;
  /** Message transform registry key. */
  messages?: string;
  /** Chat completion response transform (OpenAI-shaped body + Anthropic content). */
  responses?: string;
  /** Anthropic Messages SSE buffered rewrite (hosted search normalization). Registry key. */
  anthropicSse?: string;
}

/** Legacy name for tooling that matched hosted-tool-only rules (same payload). */
export type HostedToolRule = PlatformTransformRule;

/** Same shape as a full platform rule — messages module used this label before unification. */
export type PlatformMessageRule = PlatformTransformRule;

export const PLATFORM_TRANSFORM_RULES: readonly PlatformTransformRule[] = [
  {
    provider: "glm",
    domains: ["api.z.ai", "open.bigmodel.cn"],
    tools: { web_search: "glm-web-search-envelope" },
    messages: "glm-flatten-content",
    responses: "glm-web-search-response",
    anthropicSse: "glm-web-search-prime-normalize",
  },
  {
    provider: "xiaomimimo",
    domains: ["api.xiaomimimo.com"],
    tools: { web_search: "mimo-web-search" },
  },
];
