import { REASONING_CAPABLE, inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * OpenRouter stealth / anonymous models (e.g. stealth/ox-alpha).
 * Anthropic-compatible `/v1/messages` endpoints reject deferred tools (ToolSearch).
 */
const STEALTH_ANTHROPIC = {
  supportsSystemRoleInMessages: true,
  supportsContextManagement: false,
  supportsStructuredOutputs: false,
  supportsDeferLoading: false,
  supportsToolReferenceBlocks: false,
  supportsExtendedCacheTtl: false,
} as const;

export const STEALTH_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "stealth",
    vendor: "generic",
    match: ["stealth/*", "stealth-*"],
    meta: {
      ...MULTIMODAL,
      reasoning: { ...REASONING_CAPABLE },
      anthropic: { ...STEALTH_ANTHROPIC },
    },
  },
];
