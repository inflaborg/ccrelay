import { NO_REASONING, REASONING_CAPABLE } from "./defaults";
import type { ModelFamilyEntry } from "./types";

export const ANTHROPIC_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "claude-haiku",
    vendor: "anthropic",
    match: "claude-haiku-*",
    meta: {
      reasoning: { ...NO_REASONING },
      vision: { enabled: true },
      anthropic: { supportsSystemRoleInMessages: false },
    },
  },
  {
    id: "claude-sonnet",
    vendor: "anthropic",
    match: "claude-sonnet-*",
    meta: {
      reasoning: { ...REASONING_CAPABLE },
      vision: { enabled: true },
    },
  },
  {
    id: "claude-opus",
    vendor: "anthropic",
    match: "claude-opus-*",
    meta: {
      reasoning: { ...REASONING_CAPABLE },
      vision: { enabled: true },
    },
  },
];
