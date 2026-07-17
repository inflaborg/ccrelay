/**
 * Layer 1: declarative hostname → platform transforms (tools, messages, responses).
 * Provider implementations live under `glm/`, `xiaomimimo/`, `minimax/`, `azure-openai/`, `gemini/`, `deepseek/`.
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
   * When true, same-protocol Anthropic SSE applies `anthropicSse` per event while streaming
   * (for row-local fixes). When false, transform runs only on the buffered hosted-search path.
   */
  anthropicSseStream?: boolean;
  /**
   * After generic cross-protocol conversion to OpenAI Chat JSON: optional rewrite of body + path
   * (e.g. hosted web_search → Responses API on Azure).
   */
  requestOverride?: string;
  /** Strip client query string from outbound upstream URL when matched (e.g. Gemini rejects unknown params). */
  stripQuery?: boolean;
  /**
   * After hosted-tool transforms: keep only `function` tools plus types listed in `tools`,
   * shim Responses `custom` to string-arg `function`, drop other hosted/built-in tools.
   */
  strictTools?: boolean;
  /** Outbound Chat Completions JSON sanitize registry key (runs after tools/messages transforms). */
  requestSanitize?: string;
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
    messages: "glm-flatten-content",
    anthropicSse: "glm-web-search-prime-normalize",
    requestSanitize: "glm-chat-sanitize",
    strictTools: true,
  },
  {
    provider: "xiaomimimo",
    domains: ["api.xiaomimimo.com"],
    tools: { web_search: "mimo-web-search" },
    responses: "mimo-annotations-web-search",
    strictTools: true,
  },
  {
    provider: "xiaomimimo-token-plan",
    domainParents: ["xiaomimimo.com"],
    strictTools: true,
  },
  {
    provider: "minimax",
    domains: ["api.minimax.io", "api.minimaxi.com"],
    requestSanitize: "minimax-chat-sanitize",
    responses: "minimax-reasoning-details",
    strictTools: true,
  },
  {
    provider: "azure-openai",
    domainParents: ["cognitiveservices.azure.com"],
    requestOverride: "azure-web-search-to-responses",
    responses: "azure-responses-web-search",
    requestSanitize: "azure-chat-sanitize",
  },
  {
    provider: "gemini",
    domains: ["generativelanguage.googleapis.com"],
    stripQuery: true,
    requestSanitize: "gemini-chat-sanitize",
    responses: "gemini-thought-tags",
    strictTools: true,
  },
  {
    provider: "deepseek",
    domains: ["api.deepseek.com"],
    requestSanitize: "deepseek-chat-sanitize",
    strictTools: true,
  },
  {
    provider: "longcat",
    domains: ["api.longcat.chat"],
    anthropicSse: "longcat-message-start-usage",
    anthropicSseStream: true,
  },
];
