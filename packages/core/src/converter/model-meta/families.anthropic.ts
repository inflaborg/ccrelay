import { NO_REASONING, REASONING_CAPABLE, inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

/**
 * Fields many gateways (Azure Hosted-on-Azure, etc.) reject.
 * Opt in only when the upstream is known to support them (first-party Anthropic /
 * Foundry Hosted-on-Anthropic).
 */
const ANTHROPIC_COMPAT_DEFAULTS = {
  supportsContextManagement: false,
  supportsStructuredOutputs: false,
} as const;

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

export const ANTHROPIC_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "claude-haiku",
    vendor: "anthropic",
    match: "claude-haiku-*",
    meta: {
      ...MULTIMODAL,
      reasoning: { ...NO_REASONING },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS, supportsSystemRoleInMessages: false },
    },
  },
  {
    id: "claude-sonnet",
    vendor: "anthropic",
    match: "claude-sonnet-*",
    meta: {
      ...MULTIMODAL,
      reasoning: { ...REASONING_CAPABLE },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS },
    },
  },
  {
    id: "claude-opus",
    vendor: "anthropic",
    match: "claude-opus-*",
    meta: {
      ...MULTIMODAL,
      reasoning: { ...REASONING_CAPABLE },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS },
    },
  },
];
