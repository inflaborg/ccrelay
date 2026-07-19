import type { ModelMeta, ModelVendor } from "./types";

const REASONING_CAPABLE: ModelMeta["reasoning"] = {
  enabled: true,
  supportsEffort: true,
  supportsThinking: true,
  supportsAdaptiveThinking: true,
  supportsReasoningEffort: true,
};

const NO_REASONING: ModelMeta["reasoning"] = {
  enabled: false,
  supportsEffort: false,
  supportsThinking: false,
  supportsAdaptiveThinking: false,
  supportsReasoningEffort: false,
};

export const GLOBAL_UNKNOWN_MODEL_META: ModelMeta = {
  id: "unknown",
  vendor: "generic",
  reasoning: { ...NO_REASONING },
  vision: { enabled: false },
};

export const VENDOR_DEFAULT_META: Readonly<Record<ModelVendor, ModelMeta>> = {
  anthropic: {
    id: "anthropic-default",
    vendor: "anthropic",
    reasoning: { ...REASONING_CAPABLE },
    vision: { enabled: true },
    anthropic: {
      supportsSystemRoleInMessages: true,
      // Drop by default — Azure and most gateways reject this beta field.
      supportsContextManagement: false,
    },
  },
  openai: {
    id: "openai-default",
    vendor: "openai",
    reasoning: { enabled: false, supportsReasoningEffort: false },
    vision: { enabled: false },
    openaiChat: { usesMaxCompletionTokens: false },
  },
  gemini: {
    id: "gemini-default",
    vendor: "gemini",
    reasoning: { enabled: true, supportsReasoningEffort: true },
    vision: { enabled: true },
    gemini: { canDisableThinking: true, is25Family: false },
  },
  deepseek: {
    id: "deepseek-default",
    vendor: "deepseek",
    reasoning: { enabled: false, supportsReasoningEffort: true },
    vision: { enabled: false },
    deepseek: { isReasoner: false },
  },
  generic: GLOBAL_UNKNOWN_MODEL_META,
};

export function cloneModelMeta(meta: ModelMeta): ModelMeta {
  return {
    ...meta,
    reasoning: { ...meta.reasoning },
    vision: { ...meta.vision },
    ...(meta.openaiChat ? { openaiChat: { ...meta.openaiChat } } : {}),
    ...(meta.gemini ? { gemini: { ...meta.gemini } } : {}),
    ...(meta.deepseek ? { deepseek: { ...meta.deepseek } } : {}),
    ...(meta.anthropic ? { anthropic: { ...meta.anthropic } } : {}),
  };
}

export { REASONING_CAPABLE, NO_REASONING };
