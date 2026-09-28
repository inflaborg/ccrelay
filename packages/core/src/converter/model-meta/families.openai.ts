import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const OPENAI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
/** GPT-5.6+: none, low, medium, high, xhigh, max. `minimal` aliases to low. */
const GPT56_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
/** GPT-6+: low through max. `none` / `minimal` alias to low. */
const GPT6_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/** GPT-6 and later (gpt-6-astra, gpt-10, …). Must be matched before gpt-5. */
const GPT6_PLUS_REGEX = /^gpt-(?:[6-9]|[1-9]\d+)/;
/** GPT-5.6 and later 5.x (gpt-5.6-sol, gpt-5.10, …). Must be matched before gpt-5. */
const GPT56_PLUS_REGEX = /^gpt-5\.(?:[6-9]|\d{2,})/;
const GPT5_REGEX = /^gpt-5/;

export const OPENAI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "gpt-6",
    vendor: "openai",
    match: [],
    matchRegex: GPT6_PLUS_REGEX,
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: GPT6_REASONING_EFFORTS,
        reasoningEffortAliases: { none: "low", minimal: "low" },
        dropReasoningEffortWhenTools: true,
        preferResponses: true,
      },
    },
  },
  {
    id: "gpt-5.6",
    vendor: "openai",
    match: [],
    matchRegex: GPT56_PLUS_REGEX,
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: GPT56_REASONING_EFFORTS,
        reasoningEffortAliases: { minimal: "low" },
        dropReasoningEffortWhenTools: true,
        preferResponses: true,
      },
    },
  },
  {
    id: "gpt-5",
    vendor: "openai",
    match: [],
    matchRegex: GPT5_REGEX,
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      openaiChat: {
        usesMaxCompletionTokens: true,
        validReasoningEfforts: OPENAI_REASONING_EFFORTS,
        reasoningEffortAliases: { max: "xhigh" },
        dropReasoningEffortWhenTools: true,
        preferResponses: true,
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
        reasoningEffortAliases: { max: "xhigh" },
        dropReasoningEffortWhenTools: true,
        preferResponses: true,
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
