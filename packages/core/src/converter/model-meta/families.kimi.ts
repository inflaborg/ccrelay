import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * Moonshot / Kimi models (OpenAI-compatible and Anthropic-compatible gateways).
 * k2 / k3 and later (kimi-k2.6, kimi-k3, …) are multimodal.
 */
export const KIMI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "kimi",
    vendor: "generic",
    match: ["kimi*", "moonshot*", "k2.*", "k2-*", "k3.*", "k3-*"],
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
