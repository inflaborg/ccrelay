import type { ModelFamilyEntry } from "./types";

/** GLM models on Anthropic-compatible endpoints (Zhipu / open.bigmodel.cn). */
export const GLM_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "glm",
    vendor: "generic",
    match: "glm-*",
    meta: {
      reasoning: {
        enabled: true,
        supportsEffort: false,
        supportsThinking: true,
        supportsAdaptiveThinking: false,
        mapAdaptiveThinkingToEnabled: true,
      },
      vision: { enabled: true },
      anthropic: {
        supportsSystemRoleInMessages: false,
        supportsContextManagement: false,
        supportsStructuredOutputs: false,
        supportsDeferLoading: false,
        supportsToolReferenceBlocks: false,
        supportsExtendedCacheTtl: false,
      },
    },
  },
];
