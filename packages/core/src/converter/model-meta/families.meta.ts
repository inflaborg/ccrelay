import { REASONING_CAPABLE, inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/** Meta Muse Spark models. */
export const META_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "muse-spark",
    vendor: "generic",
    match: "muse-spark-*",
    meta: {
      ...MULTIMODAL,
      reasoning: { ...REASONING_CAPABLE },
    },
  },
];
