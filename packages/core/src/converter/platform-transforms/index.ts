/**
 * Layer 3: hostname → outbound tools, messages; inbound Chat → Anthropic content shaping.
 */

import type { AnthropicSseEventRow } from "./glm/anthropic-sse-emitter";

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import type { AnthropicContentBlock } from "../adapters/openai-chat-to-anthropic-response";
import { normalizedHostnameFromBaseUrl } from "./hostname";
import { ruleHostnameMatches } from "./ruleHostname";
import {
  PLATFORM_TRANSFORM_RULES,
  type HostedToolRule,
  type PlatformRequestOverrideResult,
} from "./rules";
import {
  MESSAGE_TRANSFORM_REGISTRY,
  REQUEST_OVERRIDE_REGISTRY,
  REQUEST_SANITIZE_REGISTRY,
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

export type {
  HostedToolTransform,
  PlatformAnthropicSseTransform,
  PlatformMessageTransform,
  PlatformRequestSanitizeTransform,
  PlatformResponseTransform,
  PlatformToolTransform,
} from "./registries";

export {
  glmWebSearchEnvelopeTransform,
  glmFlattenContentTransform,
  glmWebSearchResponseTransform,
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
  TOOL_TRANSFORM_REGISTRY,
  MESSAGE_TRANSFORM_REGISTRY,
  REQUEST_OVERRIDE_REGISTRY,
  REQUEST_SANITIZE_REGISTRY,
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

/** Routing slice used to strip outbound query per platform rule (no server-layer import). */
export interface PlatformOutboundQueryRouting {
  targetUrl: string;
  targetQuery: string;
  targetPath: string;
  provider: { baseUrl: string };
}

/** First matching provider rule wins (preserve `PLATFORM_TRANSFORM_RULES` order). */
export function matchHostedToolRuleForBaseUrl(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * When the matched platform rule sets `stripQuery`, clear client query and rebuild target URL
 * without a query string (hostname-driven; no provider-specific code in callers).
 */
export function applyPlatformQueryPolicy(routing: PlatformOutboundQueryRouting): void {
  const rule = matchHostedToolRuleForBaseUrl(routing.provider.baseUrl);
  if (!rule?.stripQuery || !routing.targetQuery) {
    return;
  }
  routing.targetQuery = "";
  const b = routing.provider.baseUrl.replace(/\/$/, "");
  const p = routing.targetPath.startsWith("/") ? routing.targetPath : `/${routing.targetPath}`;
  routing.targetUrl = `${b}${p}`;
}

/** Match first rule that declares outbound `responses` transforms. */
function matchPlatformResponseRule(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (!rule.responses) {
      continue;
    }
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

/** Match first rule that declares `messages` transforms. */
function matchPlatformMessageRule(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (!rule.messages) {
      continue;
    }
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

/** Match first rule that declares `requestOverride` transforms. */
function matchRequestOverrideRule(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (!rule.requestOverride) {
      continue;
    }
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

/** Match first rule that declares inbound Anthropic SSE buffered transforms. */
export function matchAnthropicSseRule(baseUrl: string): HostedToolRule | undefined {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return undefined;
  }
  for (const rule of PLATFORM_TRANSFORM_RULES) {
    if (!rule.anthropicSse) {
      continue;
    }
    if (ruleHostnameMatches(hostname, rule)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * Normalize one hosted Chat `tools[]` entry for `baseUrl`'s upstream.
 * Unknown upstreams use `passthrough` transform.
 */
export function normalizeToolForProvider(
  tool: Record<string, unknown>,
  baseUrl: string
): Record<string, unknown> {
  const toolType = typeof tool.type === "string" ? tool.type : "";
  const rule = matchHostedToolRuleForBaseUrl(baseUrl);
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
  toolChoice?: unknown
): NormalizeToolsResult {
  if (tools.length === 0) {
    return { tools, toolChoice };
  }

  const normalized = tools.map(t => normalizeToolForProvider(t, baseUrl));
  return { tools: normalized, toolChoice };
}

/** Alias for readability at call sites (`bodyProcessor`). */
export function applyPlatformToolTransforms(
  tools: Record<string, unknown>[],
  baseUrl: string,
  toolChoice?: unknown
): NormalizeToolsResult {
  return normalizeToolsForProvider(tools, baseUrl, toolChoice);
}

/**
 * After generic Anthropic→OpenAI Chat conversion: apply hostname-specific body/path overrides.
 */
export function applyPlatformRequestOverride(
  chatBody: Record<string, unknown>,
  chatPath: string,
  baseUrl: string
): PlatformRequestOverrideResult | null {
  const rule = matchRequestOverrideRule(baseUrl);
  if (!rule?.requestOverride) {
    return null;
  }
  const transform = REQUEST_OVERRIDE_REGISTRY[rule.requestOverride];
  return transform?.(chatBody, chatPath) ?? null;
}

/** Apply per-provider outbound message transforms inside Chat bodies. */
export function applyPlatformMessageTransforms(
  messages: OpenAIMessage[],
  baseUrl: string
): OpenAIMessage[] {
  const rule = matchPlatformMessageRule(baseUrl);
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
export function applyPlatformRequestSanitize(body: Record<string, unknown>, baseUrl: string): void {
  const rule = matchHostedToolRuleForBaseUrl(baseUrl);
  const key = rule?.requestSanitize;
  if (!key) {
    return;
  }
  const fn = REQUEST_SANITIZE_REGISTRY[key];
  fn?.(body);
}

/**
 * Inject provider-specific inbound blocks into Anthropic `content` built from upstream Chat completion JSON.
 */
export function applyPlatformResponseTransforms(
  openaiCompletionBody: Record<string, unknown>,
  anthropicContent: AnthropicContentBlock[],
  baseUrl: string
): AnthropicContentBlock[] {
  const rule = matchPlatformResponseRule(baseUrl);
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
  baseUrl: string
): AnthropicSseEventRow[] {
  const rule = matchAnthropicSseRule(baseUrl);
  if (!rule?.anthropicSse) {
    return rows;
  }
  const transform = ANTHROPIC_SSE_TRANSFORM_REGISTRY[rule.anthropicSse];
  return transform?.(rows) ?? rows;
}
