/**
 * Wizard preset schema: declarative only (no functions).
 */

export interface WizardOption {
  key: string;
  /** i18n key */
  label: string;
  type: "select" | "toggle";
  options?: { value: string; label: string }[];
  defaultValue: string | boolean;
}

/** Map one option's value to a named template placeholder */
export interface SegmentRule {
  segmentKey: string;
  fromOption: string;
  map: Record<string, string>;
}

/** Build placeholder from multiple options joined by `_` (e.g. tokenPlan_region → true_intl) */
export interface CompositeSegmentRule {
  segmentKey: string;
  /** Option keys in join order */
  optionKeys: string[];
  map: Record<string, string>;
}

export interface PresetVariant {
  providerType: "anthropic" | "openai" | "openai_chat";
  urlTemplate: string;
  idSuffix: string;
  nameSuffix: string;
  overrides?: Record<string, unknown>;
}

export interface PartnerPreset {
  id: string;
  /** i18n key for brand title */
  nameKey: string;
  icon?: string;
  mode: "inject" | "passthrough";
  authHeader?: string;
  authHeaderWhen?: { optionKey: string; equals: string | boolean };
  options: WizardOption[];
  segmentRules: SegmentRule[];
  compositeSegments?: CompositeSegmentRule[];
  variants: PresetVariant[];
  idPrefix: string;
  namePrefix: string;
  requireUserBaseUrl?: boolean;
  fixedBaseUrl?: string;
  /** Prefilled endpoint URL when `requireUserBaseUrl`; user may edit */
  defaultUserBaseUrl?: string;
  /** Default upstream model IDs (one per line in UI); prefilled and used as placeholder when empty */
  defaultModelIds: string[];
  /** When true, wizard defaults to custom model list + preset IDs; when false, use upstream GET /models */
  defaultCustomModels: boolean;
}

export interface WizardModelInput {
  modelIds: string[];
  claudeSupport: boolean;
}

export interface WizardInput extends WizardModelInput {
  selections: Record<string, string | boolean>;
  apiKey: string;
  userBaseUrl?: string;
  /** Replaces `namePrefix` when building display names */
  nameBase?: string;
  /** When false, provider uses upstream models list (no local customModelsList) */
  useCustomModels: boolean;
  /** Smart routing alias prefix; defaults to `claude-` when omitted */
  aliasPrefix?: string;
  /** Existing provider IDs — used to avoid collisions when deriving IDs from display names */
  existingProviderIds?: readonly string[];
}
