/**
 * OpenAI Chat Completions: model-dependent wire rules (official API semantics by model id).
 * Extend this module as new model families need different fields or bounds.
 */

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI Chat Completions wire field names */

import { resolveModelMeta } from "../model-meta/registry";

/** Minimal body shape for max output field assignment */
export interface OpenAiChatMaxOutputTarget {
  model: string;
  max_tokens?: number;
  max_completion_tokens?: number;
}

/**
 * Models that expect completion budget under `max_completion_tokens` (not `max_tokens`).
 */
export function openaiChatUsesMaxCompletionTokens(model: string): boolean {
  return resolveModelMeta(model, { vendor: "openai" }).openaiChat?.usesMaxCompletionTokens === true;
}

/**
 * Whether the outbound body should use `max_completion_tokens`, using upstream `model`
 * and optionally the client wire model (e.g. before Azure deployment name mapping).
 */
export function resolveOpenAiChatUsesMaxCompletionTokens(
  upstreamModel: string,
  clientModelHint?: string
): boolean {
  if (openaiChatUsesMaxCompletionTokens(upstreamModel)) {
    return true;
  }
  if (clientModelHint !== undefined && openaiChatUsesMaxCompletionTokens(clientModelHint)) {
    return true;
  }
  return false;
}

/** Set exactly one of max_tokens / max_completion_tokens on the outbound Chat Completions body. */
export function assignOpenAiChatMaxOutput(
  openai: OpenAiChatMaxOutputTarget,
  value: number,
  clientModelHint?: string
): void {
  delete openai.max_tokens;
  delete openai.max_completion_tokens;
  if (resolveOpenAiChatUsesMaxCompletionTokens(openai.model, clientModelHint)) {
    openai.max_completion_tokens = value;
  } else {
    openai.max_tokens = value;
  }
}

/**
 * Normalize whichever max-output field the client sent to the single field the upstream model expects.
 * No-op when neither field is present.
 */
export function normalizeOpenAiChatMaxOutputFields(
  body: Record<string, unknown>,
  clientModelHint?: string
): void {
  const model = typeof body.model === "string" ? body.model : "";
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
  const maxCompletion =
    typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : undefined;
  const value = maxCompletion ?? maxTokens;
  if (value === undefined) {
    return;
  }

  delete body.max_tokens;
  delete body.max_completion_tokens;
  if (resolveOpenAiChatUsesMaxCompletionTokens(model, clientModelHint)) {
    body.max_completion_tokens = value;
  } else {
    body.max_tokens = value;
  }
}

function isStreamEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * OpenAI Chat Completions streaming omits `usage` unless `stream_options.include_usage` is true.
 * Inject it on outbound bodies so relay metrics can record token counts.
 */
export function ensureOpenAiChatStreamUsageIncluded(body: Record<string, unknown>): void {
  if (!isStreamEnabled(body.stream)) {
    return;
  }

  const existing = body.stream_options;
  if (
    existing !== undefined &&
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
  ) {
    const opts = existing as Record<string, unknown>;
    if (opts.include_usage === true) {
      return;
    }
    opts.include_usage = true;
    return;
  }

  body.stream_options = { include_usage: true };
}
