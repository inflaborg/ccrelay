import type { ModelFamilyEntry } from "./types";

export const DEEPSEEK_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "deepseek-reasoner",
    vendor: "deepseek",
    match: ["deepseek-reasoner*", "deepseek-r1*"],
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: false },
      deepseek: { isReasoner: true },
    },
  },
  {
    id: "deepseek-chat",
    vendor: "deepseek",
    match: "deepseek-chat*",
    meta: {
      reasoning: { enabled: false, supportsReasoningEffort: true },
      vision: { enabled: false },
      deepseek: { isReasoner: false },
    },
  },
];
