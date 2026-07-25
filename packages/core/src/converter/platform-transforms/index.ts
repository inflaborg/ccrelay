/**
 * Layer 3: hostname → outbound tools, messages; inbound Chat → Anthropic content shaping.
 */

import type { AnthropicSseEventRow } from "./glm/anthropic-sse-emitter";

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import type { AnthropicContentBlock } from "../adapters/openai-chat-to-anthropic-response";
import { matchHostedToolRuleForBaseUrl, type PlatformMatchOptions } from "./matchRule";
import { type HostedToolRule, type PlatformRequestOverrideResult } from "./rules";
import {
  MESSAGE_TRANSFORM_REGISTRY,
  REQUEST_OVERRIDE_REGISTRY,
  REQUEST_SANITIZE_REGISTRY,
  CHAT_RESPONSE_SANITIZE_REGISTRY,
  RESPONSE_TRANSFORM_REGISTRY,
  TOOL_TRANSFORM_REGISTRY,
  ANTHROPIC_SSE_TRANSFORM_REGISTRY,
  passthroughTransform,
} from "./registries";

export type {
  HostedToolRule,
  PlatformTransformRule,
  PlatformMessageRule,
  PlatformRequestOverrideResult,
  PlatformRequestOverrideTransform,
} from "./rules";

export type { PlatformMatchOptions } from "./matchRule";
export { matchHostedToolRuleForBaseUrl } from "./matchRule";

export type {
  HostedToolTransform,
  PlatformAnthropicSseTransform,
  PlatformMessageTransform,
  PlatformRequestSanitizeTransform,
  PlatformChatResponseSanitizeTransform,
  PlatformResponseTransform,
  PlatformToolTransform,
} from "./registries";

export {
  glmFlattenContentTransform,
  glmChatSanitize,
  mimoAnnotationsWebSearchResponseTransform,
  mimoWebSearchTransform,
  minimaxChatSanitize,
  minimaxReasoningDetailsResponseTransform,
  deepseekChatSanitize,
  normalizeDeepseekEffort,
  azureWebSearchRequestOverride,
  azureResponsesWebSearchResponseTransform,
  sanitizeAzureResponsesRequestTools,
  mapAzureResponsesToolEntryForHostedWebSearch,
  azureChatSanitize,
  canGeminiDisableThinking,
  geminiChatSanitize,
  geminiThoughtTagsResponseTransform,
  normalizeGeminiEffort,
  passthroughTransform,
  isPlainObject,
  customToFunctionShim,
  openaiChatStrictToolsSanitize,
  extractLongcatToolCalls,
  parseLongcatArgValue,
  sanitizeLongcatChatCompletion,
  TOOL_TRANSFORM_REGISTRY,
  MESSAGE_TRANSFORM_REGISTRY,
  REQUEST_OVERRIDE_REGISTRY,
  REQUEST_SANITIZE_REGISTRY,
  CHAT_RESPONSE_SANITIZE_REGISTRY,
  RESPONSE_TRANSFORM_REGISTRY,
  ANTHROPIC_SSE_TRANSFORM_REGISTRY,
  TRANSFORM_REGISTRY,
} from "./registries";

export {
  hostnameMatchesDomain,
  hostnameMatchesDomainOrSubdomain,
  normalizedHostnameFromBaseUrl,
} from "./hostname";

export { ruleHostnameMatches } from "./ruleHostname";

export {
  parseAnthropicSseRows,
  serializeAnthropicSseRows,
  type AnthropicSseEventRow,
} from "./glm/anthropic-sse-emitter";

export { anthropicMessagesBodyHasHostedWebSearch } from "./anthropic-hosted-detect";
export {
  parseGlmToolResultAsSearchEntries,
  transformGlmAnthropicSearchSseRows,
  glmWebSearchServerToolName,
} from "./glm/anthropic-sse";
export { transformLongcatAnthropicSseRows } from "./longcat/anthropic-sse";

/** Routing slice used to strip outbound query per platform rule (no server-layer import). */
export interface PlatformOutboundQueryRouting {
  targetUrl: string;
  targetQuery: string;
  targetPath: string;
  provider: { baseUrl: string; openaiCompat?: PlatformMatchOptions["openaiCompat"] };
}

/**
 * When the matched platform rule sets `stripQuery`, clear client query and rebuild target URL
 * without a query string (hostname-driven; no provider-specific code in callers).
 */
export function applyPlatformQueryPolicy(routing: PlatformOutboundQueryRouting): void {
  const rule = matchHostedToolRuleForBaseUrl(routing.provider.baseUrl, {
    openaiCompat: routing.provider.openaiCompat,
  });
  if (!rule?.stripQuery || !routing.targetQuery) {
    return;
  }
  routing.targetQuery = "";
  const b = routing.provider.baseUrl.replace(/\/$/, "");
  const p = routing.targetPath.startsWith("/") ? routing.targetPath : `/${routing.targetPath}`;
  routing.targetUrl = `${b}${p}`;
}

/** Match first rule that declares outbound `responses` transforms. */
function matchPlatformResponseRule(
  baseUrl: string,
  options?: PlatformMatchOptions
): HostedToolRule | undefined {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  return rule?.responses ? rule : undefined;
}

/** Match first rule that declares `messages` transforms. */
function matchPlatformMessageRule(
  baseUrl: string,
  options?: PlatformMatchOptions
): HostedToolRule | undefined {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  return rule?.messages ? rule : undefined;
}

/** Match first rule that declares `requestOverride` transforms. */
function matchRequestOverrideRule(
  baseUrl: string,
  options?: PlatformMatchOptions
): HostedToolRule | undefined {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  return rule?.requestOverride ? rule : undefined;
}

/** Match first rule that declares inbound Anthropic SSE buffered transforms. */
export function matchAnthropicSseRule(
  baseUrl: string,
  options?: PlatformMatchOptions
): HostedToolRule | undefined {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  return rule?.anthropicSse ? rule : undefined;
}

/**
 * Normalize one hosted Chat `tools[]` entry for `baseUrl`'s upstream.
 * Unknown upstreams use `passthrough` transform.
 */
export function normalizeToolForProvider(
  tool: Record<string, unknown>,
  baseUrl: string,
  options?: PlatformMatchOptions
): Record<string, unknown> {
  const toolType = typeof tool.type === "string" ? tool.type : "";
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  const transformName = rule?.tools?.[toolType] ?? "passthrough";
  const transform = TOOL_TRANSFORM_REGISTRY[transformName] ?? passthroughTransform;
  return transform(tool);
}

export interface NormalizeToolsResult {
  tools: Record<string, unknown>[];
  toolChoice?: unknown;
}

/**
 * Apply per-provider outbound transforms to Chat Completions `tools[]` before upstream.
 */
export function normalizeToolsForProvider(
  tools: Record<string, unknown>[],
  baseUrl: string,
  toolChoice?: unknown,
  options?: PlatformMatchOptions
): NormalizeToolsResult {
  if (tools.length === 0) {
    return { tools, toolChoice };
  }

  const normalized = tools.map(t => normalizeToolForProvider(t, baseUrl, options));
  return { tools: normalized, toolChoice };
}

/** Alias for readability at call sites (`bodyProcessor`). */
export function applyPlatformToolTransforms(
  tools: Record<string, unknown>[],
  baseUrl: string,
  toolChoice?: unknown,
  options?: PlatformMatchOptions
): NormalizeToolsResult {
  return normalizeToolsForProvider(tools, baseUrl, toolChoice, options);
}

/**
 * After generic Anthropic→OpenAI Chat conversion: apply hostname-specific body/path overrides.
 */
export function applyPlatformRequestOverride(
  chatBody: Record<string, unknown>,
  chatPath: string,
  baseUrl: string,
  options?: PlatformMatchOptions
): PlatformRequestOverrideResult | null {
  const rule = matchRequestOverrideRule(baseUrl, options);
  if (!rule?.requestOverride) {
    return null;
  }
  const transform = REQUEST_OVERRIDE_REGISTRY[rule.requestOverride];
  return transform?.(chatBody, chatPath) ?? null;
}

/** Apply per-provider outbound message transforms inside Chat bodies. */
export function applyPlatformMessageTransforms(
  messages: OpenAIMessage[],
  baseUrl: string,
  options?: PlatformMatchOptions
): OpenAIMessage[] {
  const rule = matchPlatformMessageRule(baseUrl, options);
  if (!rule?.messages) {
    return messages;
  }
  const transform = MESSAGE_TRANSFORM_REGISTRY[rule.messages];
  if (!transform) {
    return messages;
  }
  return transform(messages);
}

/**
 * Apply outbound Chat Completions body sanitization when the platform rule declares `requestSanitize`.
 */
export function applyPlatformRequestSanitize(
  body: Record<string, unknown>,
  baseUrl: string,
  options?: PlatformMatchOptions
): void {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  const key = rule?.requestSanitize;
  if (!key) {
    return;
  }
  const fn = REQUEST_SANITIZE_REGISTRY[key];
  fn?.(body);
}

/**
 * Apply inbound OpenAI Chat Completions sanitization (e.g. LongCat XML → `tool_calls`)
 * when the platform rule declares `chatResponseSanitize`.
 */
export function applyPlatformChatResponseSanitize(
  body: Record<string, unknown>,
  baseUrl: string,
  options?: PlatformMatchOptions
): void {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  const key = rule?.chatResponseSanitize;
  if (!key) {
    return;
  }
  const fn = CHAT_RESPONSE_SANITIZE_REGISTRY[key];
  fn?.(body);
}

/** True when the platform rule buffers streamed assistant text to rewrite tool XML at finish. */
export function platformBuffersChatContentForToolParse(
  baseUrl: string,
  options?: PlatformMatchOptions
): boolean {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl, options);
  return typeof rule?.chatResponseSanitize === "string" && rule.chatResponseSanitize.length > 0;
}

/**
 * Inject provider-specific inbound blocks into Anthropic `content` built from upstream Chat completion JSON.
 */
export function applyPlatformResponseTransforms(
  openaiCompletionBody: Record<string, unknown>,
  anthropicContent: AnthropicContentBlock[],
  baseUrl: string,
  options?: PlatformMatchOptions
): AnthropicContentBlock[] {
  const rule = matchPlatformResponseRule(baseUrl, options);
  if (!rule?.responses) {
    return anthropicContent;
  }
  const transform = RESPONSE_TRANSFORM_REGISTRY[rule.responses];
  if (!transform) {
    return anthropicContent;
  }
  return transform(openaiCompletionBody, anthropicContent);
}

/**
 * Apply Anthropic SSE row rewrite from `PLATFORM_TRANSFORM_RULES` (hostname + registry key).
 * No-op when `baseUrl` has no matching `anthropicSse` rule.
 */
export function applyAnthropicSseRowsPlatformTransform(
  rows: AnthropicSseEventRow[],
  baseUrl: string,
  options?: PlatformMatchOptions
): AnthropicSseEventRow[] {
  const rule = matchAnthropicSseRule(baseUrl, options);
  if (!rule?.anthropicSse) {
    return rows;
  }
  const transform = ANTHROPIC_SSE_TRANSFORM_REGISTRY[rule.anthropicSse];
  return transform?.(rows) ?? rows;
}
