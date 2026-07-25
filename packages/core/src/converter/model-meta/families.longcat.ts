import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * Meituan LongCat (api.longcat.chat). LongCat-2.0 and peers accept image input.
 */
export const LONGCAT_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "longcat",
    vendor: "generic",
    match: ["longcat*", "long-cat*"],
    meta: {
      ...MULTIMODAL,
      reasoning: {
        enabled: true,
        supportsEffort: true,
        supportsThinking: true,
        supportsAdaptiveThinking: false,
        supportsReasoningEffort: true,
      },
    },
  },
];
