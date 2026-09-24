import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const TEXT_ONLY = inputMetaFromModalities(["text"]);
const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

const GLM_ANTHROPIC = {
  supportsSystemRoleInMessages: false,
  supportsContextManagement: false,
  supportsStructuredOutputs: false,
  supportsDeferLoading: false,
  supportsToolReferenceBlocks: false,
  supportsExtendedCacheTtl: false,
} as const;

const GLM_REASONING = {
  enabled: true,
  supportsEffort: false,
  supportsThinking: true,
  supportsAdaptiveThinking: false,
  mapAdaptiveThinkingToEnabled: true,
} as const;

/**
 * GLM on Anthropic/OpenAI-compatible gateways (Zhipu / open.bigmodel.cn).
 * Vision variants (`glm-4v`, `glm-5v-turbo`, …) and `glm-5.3-flash` or newer flash
 * names accept image. Other glm-* stay text-only.
 */
export const GLM_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "glm-vision",
    vendor: "generic",
    // Prefer digit+v forms (glm-5v-turbo, glm-4.5v) — avoid matching names like "glm-overview".
    match: ["glm-*v-*", "glm-*v"],
    matchRegex: /^glm-[\d.]+v([.-]|$)/,
    meta: {
      ...MULTIMODAL,
      reasoning: { ...GLM_REASONING },
      anthropic: { ...GLM_ANTHROPIC },
    },
  },
  {
    id: "glm-flash",
    vendor: "generic",
    // glm-5.3-flash and later flash names (5.3, 5.10, 6, 10). glm-5.2-flash stays text-only.
    match: [],
    matchRegex:
      /^glm-(?:5\.(?:[3-9]|\d{2,})(?:\.\d+)?|[6-9](?:\.\d+)?|[1-9]\d+(?:\.\d+)?)-flash(?:[.-]|$)/,
    meta: {
      ...MULTIMODAL,
      reasoning: { ...GLM_REASONING },
      anthropic: { ...GLM_ANTHROPIC },
    },
  },
  {
    id: "glm",
    vendor: "generic",
    match: "glm-*",
    meta: {
      ...TEXT_ONLY,
      reasoning: { ...GLM_REASONING },
      anthropic: { ...GLM_ANTHROPIC },
    },
  },
];
