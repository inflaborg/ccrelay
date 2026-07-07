import type { ModelFamilyEntry } from "./types";

const OPENAI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export const OPENAI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "gpt-5",
    vendor: "openai",
    match: "gpt-5*",
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: OPENAI_REASONING_EFFORTS,
      },
    },
  },
  {
    id: "o-series",
    vendor: "openai",
    match: [],
    matchRegex: /^o\d/,
    meta: {
      reasoning: { enabled: true, supportsReasoningEffort: true },
      vision: { enabled: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: OPENAI_REASONING_EFFORTS,
      },
    },
  },
  {
    id: "gpt-4o",
    vendor: "openai",
    match: "gpt-4o*",
    meta: {
      reasoning: { enabled: false, supportsReasoningEffort: false },
      vision: { enabled: true },
      openaiChat: { usesMaxCompletionTokens: false },
    },
  },
];
