import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const OPENAI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

export const OPENAI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "gpt-5",
    vendor: "openai",
    match: "gpt-5*",
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: OPENAI_REASONING_EFFORTS,
        dropReasoningEffortWhenTools: true,
      },
    },
  },
  {
    id: "o-series",
    vendor: "openai",
    match: [],
    matchRegex: /^o\d/,
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: OPENAI_REASONING_EFFORTS,
        dropReasoningEffortWhenTools: true,
      },
    },
  },
  {
    id: "gpt-4o",
    vendor: "openai",
    match: "gpt-4o*",
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: false, supportsReasoningEffort: false },
      openaiChat: { usesMaxCompletionTokens: false },
    },
  },
  {
    id: "gpt-4",
    vendor: "openai",
    match: ["gpt-4*", "gpt-4.1*", "chatgpt-4o*"],
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: false, supportsReasoningEffort: false },
      openaiChat: { usesMaxCompletionTokens: false },
    },
  },
  {
    id: "gpt-3.5",
    vendor: "openai",
    match: "gpt-3.5*",
    meta: {
      ...inputMetaFromModalities(["text"]),
      reasoning: { enabled: false, supportsReasoningEffort: false },
      openaiChat: { usesMaxCompletionTokens: false },
    },
  },
  {
    id: "gpt-generic",
    vendor: "openai",
    match: "gpt-*",
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: false, supportsReasoningEffort: false },
      openaiChat: { usesMaxCompletionTokens: false },
    },
  },
];
