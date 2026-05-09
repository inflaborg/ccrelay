/**
 * Layer 1: declarative hostname → platform transforms (tools, messages, responses).
 * Provider implementations live under `glm/`, `xiaomimimo/`, `azure-openai/`.
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire tool.type literals */

export interface PlatformTransformRule {
  provider: string;
  /** Exact hostname matches (case-insensitive). */
  domains?: readonly string[];
  /**
   * Match hostname equal to or as a subdomain of these parents (any `*.parent`).
   * Used for hosts like regional Azure endpoints (`*.cognitiveservices.azure.com`).
   */
  domainParents?: readonly string[];
  /** Chat `tools[].type` → tool transform registry key. */
  tools?: Readonly<Record<string, string>>;
  /** Message transform registry key. */
  messages?: string;
  /** Chat completion response transform (OpenAI-shaped body + Anthropic content). */
  responses?: string;
  /** Anthropic Messages SSE buffered rewrite (hosted search normalization). Registry key. */
  anthropicSse?: string;
  /**
   * After generic cross-protocol conversion to OpenAI Chat JSON: optional rewrite of body + path
   * (e.g. hosted web_search → Responses API on Azure).
   */
  requestOverride?: string;
}

/** Legacy name for tooling that matched hosted-tool-only rules (same payload). */
export type HostedToolRule = PlatformTransformRule;

/** Same shape as a full platform rule — messages module used this label before unification. */
export type PlatformMessageRule = PlatformTransformRule;

/** Result of rewriting OpenAI Chat JSON + path after cross-protocol conversion (request override). */
export interface PlatformRequestOverrideResult {
  body: Record<string, unknown>;
  path: string;
  /** Upstream response wire shape for executor conversion (e.g. OpenAI Responses JSON). */
  responseFormat?: string;
}

export type PlatformRequestOverrideTransform = (
  chatBody: Record<string, unknown>,
  chatPath: string
) => PlatformRequestOverrideResult | null;

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
    responses: "mimo-annotations-web-search",
  },
  {
    provider: "azure-openai",
    domainParents: ["cognitiveservices.azure.com"],
    requestOverride: "azure-web-search-to-responses",
    responses: "azure-responses-web-search",
  },
];
