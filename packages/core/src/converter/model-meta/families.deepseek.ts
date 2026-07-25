import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const TEXT_ONLY = inputMetaFromModalities(["text"]);

export const DEEPSEEK_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "deepseek-reasoner",
    vendor: "deepseek",
    match: ["deepseek-reasoner*", "deepseek-r1*"],
    meta: {
      ...TEXT_ONLY,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      deepseek: { isReasoner: true },
    },
  },
  {
    id: "deepseek-chat",
    vendor: "deepseek",
    match: "deepseek-chat*",
    meta: {
      ...TEXT_ONLY,
      reasoning: { enabled: false, supportsReasoningEffort: true },
      deepseek: { isReasoner: false },
    },
  },
];
