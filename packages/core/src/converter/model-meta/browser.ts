/**
 * Browser-safe model-meta surface (no sanitize / Node-only paths).
 * Web UI should import from `@ccrelay/model-meta` (aliased here).
 */

export type { ModelInputMeta, ModelInputModality, ModelMeta, ModelVendor } from "./types";
export {
  TEXT_IMAGE_INPUT,
  TEXT_ONLY_INPUT,
  GLOBAL_UNKNOWN_MODEL_META,
  inputMetaFromModalities,
} from "./defaults";
export { modelSupportsImageInput, resolveModelMeta } from "./registry";
