import type { ModelInputMeta, ModelInputModality, ModelMeta, ModelVendor } from "./types";

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

/** Conservative default: text-only input. */
export const TEXT_ONLY_INPUT: ModelInputMeta = {
  modalities: ["text"],
};

/** Multimodal: text + image (Claude / GPT / Gemini / Kimi / GLM vision, etc.). */
export const TEXT_IMAGE_INPUT: ModelInputMeta = {
  modalities: ["text", "image"],
};

export function inputMetaFromModalities(modalities: readonly ModelInputModality[]): {
  input: ModelInputMeta;
  vision: ModelMeta["vision"];
} {
  const unique: ModelInputModality[] = [];
  for (const m of modalities) {
    if (!unique.includes(m)) {
      unique.push(m);
    }
  }
  if (!unique.includes("text")) {
    unique.unshift("text");
  }
  return {
    input: { modalities: unique },
    vision: { enabled: unique.includes("image") },
  };
}

export const GLOBAL_UNKNOWN_MODEL_META: ModelMeta = {
  id: "unknown",
  vendor: "generic",
  ...inputMetaFromModalities(["text"]),
  reasoning: { ...NO_REASONING },
};

export const VENDOR_DEFAULT_META: Readonly<Record<ModelVendor, ModelMeta>> = {
  anthropic: {
    id: "anthropic-default",
    vendor: "anthropic",
    ...inputMetaFromModalities(["text", "image"]),
    reasoning: { ...REASONING_CAPABLE },
    anthropic: {
      supportsSystemRoleInMessages: true,
      // Drop by default — Azure Hosted-on-Azure and most gateways reject these.
      supportsContextManagement: false,
      supportsStructuredOutputs: false,
    },
  },
  openai: {
    id: "openai-default",
    vendor: "openai",
    ...inputMetaFromModalities(["text"]),
    reasoning: { enabled: false, supportsReasoningEffort: false },
    openaiChat: { usesMaxCompletionTokens: false },
  },
  gemini: {
    id: "gemini-default",
    vendor: "gemini",
    ...inputMetaFromModalities(["text", "image"]),
    reasoning: { enabled: true, supportsReasoningEffort: true },
    gemini: { canDisableThinking: true, is25Family: false },
  },
  deepseek: {
    id: "deepseek-default",
    vendor: "deepseek",
    ...inputMetaFromModalities(["text"]),
    reasoning: { enabled: false, supportsReasoningEffort: true },
    deepseek: { isReasoner: false },
  },
  generic: GLOBAL_UNKNOWN_MODEL_META,
};

export function cloneModelMeta(meta: ModelMeta): ModelMeta {
  return {
    ...meta,
    input: { modalities: [...meta.input.modalities] },
    reasoning: { ...meta.reasoning },
    vision: { ...meta.vision },
    ...(meta.openaiChat ? { openaiChat: { ...meta.openaiChat } } : {}),
    ...(meta.gemini ? { gemini: { ...meta.gemini } } : {}),
    ...(meta.deepseek ? { deepseek: { ...meta.deepseek } } : {}),
    ...(meta.anthropic ? { anthropic: { ...meta.anthropic } } : {}),
  };
}

export { REASONING_CAPABLE, NO_REASONING };
