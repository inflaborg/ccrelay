import type { ModelFamilyEntry } from "./types";

export const GEMINI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "gemini-2.5-flash",
    vendor: "gemini",
    match: ["*2.5*flash*", "gemini-2.5-flash*"],
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: true },
      gemini: { canDisableThinking: true, is25Family: true },
    },
  },
  {
    id: "gemini-2.5-pro",
    vendor: "gemini",
    match: ["*2.5*pro*", "gemini-2.5-pro*"],
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: true },
      gemini: { canDisableThinking: false, is25Family: true },
    },
  },
  {
    id: "gemini-3-plus",
    vendor: "gemini",
    match: [],
    matchRegex: /^gemini-[3-9]/,
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: true },
      gemini: { canDisableThinking: false, is25Family: false },
    },
  },
];
