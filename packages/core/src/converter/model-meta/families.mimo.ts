import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const TEXT_ONLY = inputMetaFromModalities(["text"]);
const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * Xiaomi MiMo (api.xiaomimimo.com).
 * mimo-v2.5 supports image; mimo-v2.5-pro is text-only.
 */
export const MIMO_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "mimo-v2.5-pro",
    vendor: "generic",
    match: ["mimo-v2.5-pro*", "mimo-v2.5pro*", "mimo-v2-5-pro*"],
    meta: {
      ...TEXT_ONLY,
      reasoning: {
        enabled: true,
        supportsEffort: true,
        supportsThinking: true,
        supportsAdaptiveThinking: false,
        supportsReasoningEffort: true,
      },
    },
  },
  {
    id: "mimo-v2.5",
    vendor: "generic",
    match: ["mimo-v2.5*", "mimo-v2-5*", "mimo*"],
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
