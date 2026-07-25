export type {
  ModelAnthropicMeta,
  ModelDeepSeekMeta,
  ModelFamilyEntry,
  ModelGeminiMeta,
  ModelInputMeta,
  ModelInputModality,
  ModelMeta,
  ModelOpenAiChatMeta,
  ModelReasoningMeta,
  ModelVendor,
  ModelVisionMeta,
  ResolveModelMetaOptions,
} from "./types";

export {
  GLOBAL_UNKNOWN_MODEL_META,
  TEXT_IMAGE_INPUT,
  TEXT_ONLY_INPUT,
  VENDOR_DEFAULT_META,
  inputMetaFromModalities,
} from "./defaults";
export { listModelFamilies, modelSupportsImageInput, resolveModelMeta } from "./registry";
export {
  sanitizeAnthropicRequestByMeta,
  sanitizeAnthropicRequestRecord,
} from "./sanitize-anthropic";
export {
  sanitizeOpenAiChatRequestByMeta,
  sanitizeOpenAiChatRequestRecord,
} from "./sanitize-openai-chat";

import { resolveModelMeta } from "./registry";

/** Whether Gemini models accept `reasoning_effort: none` (thinking_budget 0). */
export function canGeminiDisableThinking(model: string): boolean {
  return resolveModelMeta(model, { vendor: "gemini" }).gemini?.canDisableThinking === true;
}

/** Whether the model id is in the Gemini 2.5 family (thinking_budget wire). */
export function isGemini25Model(model: string): boolean {
  return resolveModelMeta(model, { vendor: "gemini" }).gemini?.is25Family === true;
}
