import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * xAI Grok models. grok-4.1 / 4.20 / 4.3 / 4.5 and peers accept image input.
 */
export const GROK_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "grok",
    vendor: "generic",
    match: ["grok-*", "grok*"],
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
