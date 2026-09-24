import { REASONING_CAPABLE, inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/** Qwen3 models, including VL names. */
export const QWEN_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "qwen3",
    vendor: "generic",
    match: "qwen3*",
    meta: {
      ...MULTIMODAL,
      reasoning: { ...REASONING_CAPABLE },
    },
  },
];
