import { NO_REASONING, REASONING_CAPABLE } from "./defaults";
import type { ModelFamilyEntry } from "./types";

/** Beta fields many gateways (Azure, etc.) reject; opt in only for first-party Anthropic. */
const ANTHROPIC_COMPAT_DEFAULTS = {
  supportsContextManagement: false,
} as const;

export const ANTHROPIC_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "claude-haiku",
    vendor: "anthropic",
    match: "claude-haiku-*",
    meta: {
      reasoning: { ...NO_REASONING },
      vision: { enabled: true },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS, supportsSystemRoleInMessages: false },
    },
  },
  {
    id: "claude-sonnet",
    vendor: "anthropic",
    match: "claude-sonnet-*",
    meta: {
      reasoning: { ...REASONING_CAPABLE },
      vision: { enabled: true },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS },
    },
  },
  {
    id: "claude-opus",
    vendor: "anthropic",
    match: "claude-opus-*",
    meta: {
      reasoning: { ...REASONING_CAPABLE },
      vision: { enabled: true },
      anthropic: { ...ANTHROPIC_COMPAT_DEFAULTS },
    },
  },
];
