/**
 * Layer 2: named transforms — separate registries for tools, messages, responses.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import type { AnthropicContentBlock } from "../adapters/openai-chat-to-anthropic-response";
import type { AnthropicSseEventRow } from "./glm/anthropic-sse-emitter";
import { azureWebSearchRequestOverride } from "./azure-openai/request-override";
import { azureResponsesWebSearchResponseTransform } from "./azure-openai/responses-web-search";
import { transformGlmAnthropicSearchSseRows } from "./glm/anthropic-sse";
import { glmWebSearchEnvelopeTransform } from "./glm/tools";
import { glmFlattenContentTransform } from "./glm/messages";
import { glmWebSearchResponseTransform } from "./glm/responses";
import { mimoWebSearchTransform } from "./xiaomimimo/tools";
import { mimoAnnotationsWebSearchResponseTransform } from "./xiaomimimo/responses";
import type { PlatformRequestOverrideTransform } from "./rules";
import { azureChatSanitize } from "./azure-openai/chat-sanitize";
import { glmChatSanitize } from "./glm/request-sanitize";
import { geminiChatSanitize } from "./gemini/request-sanitize";
import { geminiThoughtTagsResponseTransform } from "./gemini/response-thoughts";
import { minimaxChatSanitize } from "./minimax/request-sanitize";
import { minimaxReasoningDetailsResponseTransform } from "./minimax/response-reasoning";
import { passthroughTransform } from "./passthrough";

/** Outbound Chat `tools[]` entry (`type` keyed by rule). */
export type PlatformToolTransform = (tool: Record<string, unknown>) => Record<string, unknown>;

/** Legacy alias (same function shape as hosted outbound tools). */
export type HostedToolTransform = PlatformToolTransform;

export type PlatformMessageTransform = (messages: OpenAIMessage[]) => OpenAIMessage[];

/** Inbound Chat completion blob + Anthropic `content` slice (post protocol conversion). */
export type PlatformResponseTransform = (
  openaiCompletionBody: Record<string, unknown>,
  anthropicContent: AnthropicContentBlock[]
) => AnthropicContentBlock[];

/** Buffered rewrite of upstream Anthropic `text/event-stream` rows (`data:` payloads). */
export type PlatformAnthropicSseTransform = (
  rows: AnthropicSseEventRow[]
) => AnthropicSseEventRow[];

/** Outbound Chat Completions JSON body sanitize (provider-specific). */
export type PlatformRequestSanitizeTransform = (body: Record<string, unknown>) => void;

export const REQUEST_OVERRIDE_REGISTRY: Readonly<Record<string, PlatformRequestOverrideTransform>> =
  {
    "azure-web-search-to-responses": azureWebSearchRequestOverride,
  };

export const TOOL_TRANSFORM_REGISTRY: Readonly<Record<string, PlatformToolTransform>> = {
  "glm-web-search-envelope": glmWebSearchEnvelopeTransform,
  "mimo-web-search": mimoWebSearchTransform,
  passthrough: passthroughTransform,
};

export const MESSAGE_TRANSFORM_REGISTRY: Readonly<Record<string, PlatformMessageTransform>> = {
  "glm-flatten-content": glmFlattenContentTransform,
};

export const RESPONSE_TRANSFORM_REGISTRY: Readonly<Record<string, PlatformResponseTransform>> = {
  "glm-web-search-response": glmWebSearchResponseTransform,
  "mimo-annotations-web-search": mimoAnnotationsWebSearchResponseTransform,
  "minimax-reasoning-details": minimaxReasoningDetailsResponseTransform,
  "azure-responses-web-search": azureResponsesWebSearchResponseTransform,
  "gemini-thought-tags": geminiThoughtTagsResponseTransform,
};

export const ANTHROPIC_SSE_TRANSFORM_REGISTRY: Readonly<
  Record<string, PlatformAnthropicSseTransform>
> = {
  "glm-web-search-prime-normalize": transformGlmAnthropicSearchSseRows,
};

export const REQUEST_SANITIZE_REGISTRY: Readonly<Record<string, PlatformRequestSanitizeTransform>> =
  {
    "azure-chat-sanitize": azureChatSanitize,
    "gemini-chat-sanitize": geminiChatSanitize,
    "glm-chat-sanitize": glmChatSanitize,
    "minimax-chat-sanitize": minimaxChatSanitize,
  };

export { passthroughTransform, isPlainObject } from "./passthrough";
export { glmWebSearchEnvelopeTransform } from "./glm/tools";
export { glmFlattenContentTransform } from "./glm/messages";
export { glmWebSearchResponseTransform } from "./glm/responses";
export { mimoAnnotationsWebSearchResponseTransform } from "./xiaomimimo/responses";
export { mimoWebSearchTransform } from "./xiaomimimo/tools";
export { azureWebSearchRequestOverride } from "./azure-openai/request-override";
export { azureResponsesWebSearchResponseTransform } from "./azure-openai/responses-web-search";
export {
  mapAzureResponsesToolEntryForHostedWebSearch,
  sanitizeAzureResponsesRequestTools,
} from "./azure-openai/responses-request-tools";
export { azureChatSanitize } from "./azure-openai/chat-sanitize";
export { glmChatSanitize } from "./glm/request-sanitize";
export {
  canGeminiDisableThinking,
  geminiChatSanitize,
  normalizeGeminiEffort,
} from "./gemini/request-sanitize";
export { geminiThoughtTagsResponseTransform } from "./gemini/response-thoughts";
export { minimaxChatSanitize } from "./minimax/request-sanitize";
export { minimaxReasoningDetailsResponseTransform } from "./minimax/response-reasoning";

/** @deprecated Prefer `TOOL_TRANSFORM_REGISTRY`. */
export const TRANSFORM_REGISTRY = TOOL_TRANSFORM_REGISTRY;
