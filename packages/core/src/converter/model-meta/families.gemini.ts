import { inputMetaFromModalities } from "./defaults";
import type { ModelFamilyEntry } from "./types";

const MULTIMODAL = inputMetaFromModalities(["text", "image"]);

/**
 * Google Gemini — full series accepts image input.
 * Specific rows keep thinking_budget wiring; catch-all covers 2.x / 3.x / future ids.
 */
export const GEMINI_MODEL_FAMILIES: readonly ModelFamilyEntry[] = [
  {
    id: "gemini-2.5-flash",
    vendor: "gemini",
    match: ["*2.5*flash*", "gemini-2.5-flash*"],
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      gemini: { canDisableThinking: true, is25Family: true },
    },
  },
  {
    id: "gemini-2.5-pro",
    vendor: "gemini",
    match: ["*2.5*pro*", "gemini-2.5-pro*"],
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      gemini: { canDisableThinking: false, is25Family: true },
    },
  },
  {
    id: "gemini-3-plus",
    vendor: "gemini",
    match: [],
    // gemini-3.1-flash, gemini-3.5-flash, gemini-3.6-flash, gemini-3.1-pro, …
    matchRegex: /^gemini-[3-9]/,
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      gemini: { canDisableThinking: false, is25Family: false },
    },
  },
  {
    id: "gemini",
    vendor: "gemini",
    match: ["gemini*", "models/gemini*"],
    meta: {
      ...MULTIMODAL,
      reasoning: { enabled: true, supportsReasoningEffort: true },
      gemini: { canDisableThinking: false, is25Family: false },
    },
  },
];
