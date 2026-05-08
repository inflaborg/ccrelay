/**
 * Layer 2: named transforms — separate registries for tools, messages, responses.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import type { AnthropicContentBlock } from "../adapters/openai-chat-to-anthropic-response";
import type { AnthropicSseEventRow } from "./glm/anthropic-sse-emitter";
import { transformGlmAnthropicSearchSseRows } from "./glm/anthropic-sse";
import { glmWebSearchEnvelopeTransform } from "./glm/tools";
import { glmFlattenContentTransform } from "./glm/messages";
import { glmWebSearchResponseTransform } from "./glm/responses";
import { mimoWebSearchTransform } from "./xiaomimimo/tools";
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
};

export const ANTHROPIC_SSE_TRANSFORM_REGISTRY: Readonly<
  Record<string, PlatformAnthropicSseTransform>
> = {
  "glm-web-search-prime-normalize": transformGlmAnthropicSearchSseRows,
};

export { passthroughTransform, isPlainObject } from "./passthrough";
export { glmWebSearchEnvelopeTransform } from "./glm/tools";
export { glmFlattenContentTransform } from "./glm/messages";
export { glmWebSearchResponseTransform } from "./glm/responses";
export { mimoWebSearchTransform } from "./xiaomimimo/tools";

/** @deprecated Prefer `TOOL_TRANSFORM_REGISTRY`. */
export const TRANSFORM_REGISTRY = TOOL_TRANSFORM_REGISTRY;
