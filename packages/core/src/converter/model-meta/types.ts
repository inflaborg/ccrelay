/**
 * Static model capability metadata for protocol sanitization and cross-protocol conversion.
 */

export type ModelVendor = "anthropic" | "openai" | "gemini" | "deepseek" | "generic";

export interface ModelReasoningMeta {
  /** Whether the model family supports extended / adaptive reasoning. */
  enabled: boolean;
  /** Anthropic `output_config.effort`. */
  supportsEffort?: boolean;
  /** Anthropic top-level `thinking`. */
  supportsThinking?: boolean;
  /** Anthropic `thinking.type = adaptive`. */
  supportsAdaptiveThinking?: boolean;
  /**
   * When adaptive thinking is unsupported, rewrite `thinking.type` to `enabled`
   * instead of removing the field (e.g. GLM Anthropic-compatible API).
   */
  mapAdaptiveThinkingToEnabled?: boolean;
  /** OpenAI Chat `reasoning_effort`. */
  supportsReasoningEffort?: boolean;
}

export interface ModelVisionMeta {
  enabled: boolean;
}

export interface ModelOpenAiChatMeta {
  usesMaxCompletionTokens?: boolean;
  validReasoningEfforts?: readonly string[];
}

export interface ModelGeminiMeta {
  /** Gemini 2.5 Flash-style models may set thinking_budget to 0. */
  canDisableThinking?: boolean;
  /** Uses `thinking_budget` instead of `thinking_level`. */
  is25Family?: boolean;
}

export interface ModelDeepSeekMeta {
  /** DeepSeek reasoner-style models use native thinking + effort normalization. */
  isReasoner?: boolean;
}

export interface ModelAnthropicMeta {
  /** When false, hoist `messages` entries with role system/developer into top-level `system`. */
  supportsSystemRoleInMessages?: boolean;
  /** When false, strip top-level `context_management`. */
  supportsContextManagement?: boolean;
  /**
   * When false, strip `output_config.format` (structured outputs / json_schema).
   * Azure Hosted-on-Azure and many gateways reject this; official Anthropic supports it.
   */
  supportsStructuredOutputs?: boolean;
  /** When false, strip `defer_loading` from tools and drop deferred placeholder tools. */
  supportsDeferLoading?: boolean;
  /** When false, rewrite `tool_reference` blocks in tool results to plain text. */
  supportsToolReferenceBlocks?: boolean;
  /** When false, strip `cache_control.ttl` (keep ephemeral without extended TTL). */
  supportsExtendedCacheTtl?: boolean;
}

export interface ModelMeta {
  id: string;
  vendor: ModelVendor;
  reasoning: ModelReasoningMeta;
  vision: ModelVisionMeta;
  openaiChat?: ModelOpenAiChatMeta;
  gemini?: ModelGeminiMeta;
  deepseek?: ModelDeepSeekMeta;
  anthropic?: ModelAnthropicMeta;
}

/** Declarative family row in the static registry. */
export interface ModelFamilyEntry {
  id: string;
  vendor: ModelVendor;
  /** Glob patterns passed to {@link minimatch} (lowercase model id). */
  match: string | readonly string[];
  /** Optional regex when glob is insufficient (e.g. OpenAI o-series). */
  matchRegex?: RegExp;
  meta: Omit<ModelMeta, "id" | "vendor">;
  /** Exact model id patches applied after family match. */
  overrides?: readonly {
    match: string;
    patch: Partial<Omit<ModelMeta, "id" | "vendor">>;
  }[];
}

export interface ResolveModelMetaOptions {
  vendor?: ModelVendor;
}
