import type { PartnerPreset } from "./types";

/** Newline-separated default model list for textarea value / placeholder */
export function defaultModelIdsAsText(preset: PartnerPreset): string {
  return preset.defaultModelIds.join("\n");
}

/** OpenAI official Chat API base + Anthropic official API base (editable; defaults prefilled). */
export const GENERIC_ENDPOINT_PRESETS: readonly PartnerPreset[] = [
  {
    id: "generic-openai-chat",
    nameKey: "wizard.brand.genericOpenaiChat",
    mode: "inject",
    idPrefix: "openai-chat",
    namePrefix: "OpenAI-Chat",
    defaultModelIds: [],
    defaultCustomModels: false,
    authHeader: "authorization",
    requireUserBaseUrl: true,
    defaultUserBaseUrl: "https://api.openai.com/v1",
    options: [],
    segmentRules: [],
    variants: [
      {
        providerType: "openai_chat",
        urlTemplate: "{userBaseUrl}",
        idSuffix: "upstream",
        nameSuffix: "",
      },
    ],
  },
  {
    id: "generic-anthropic",
    nameKey: "wizard.brand.genericAnthropic",
    mode: "inject",
    idPrefix: "anthropic",
    namePrefix: "Anthropic",
    defaultModelIds: [],
    defaultCustomModels: false,
    authHeader: "authorization",
    requireUserBaseUrl: true,
    defaultUserBaseUrl: "https://api.anthropic.com",
    options: [],
    segmentRules: [],
    variants: [
      {
        providerType: "anthropic",
        urlTemplate: "{userBaseUrl}",
        idSuffix: "upstream",
        nameSuffix: "",
      },
    ],
  },
];

export const PARTNER_PRESETS: readonly PartnerPreset[] = [
  {
    id: "glm",
    nameKey: "wizard.brand.glm",
    mode: "inject",
    idPrefix: "glm",
    namePrefix: "GLM",
    defaultModelIds: ["glm-5.1", "glm-5-turbo", "glm-4.7"],
    defaultCustomModels: true,
    options: [
      {
        key: "region",
        label: "wizard.option.region",
        type: "select",
        options: [
          { value: "intl", label: "wizard.region.international" },
          { value: "cn", label: "wizard.region.china" },
        ],
        defaultValue: "intl",
      },
      {
        key: "plan",
        label: "wizard.option.codingPlan",
        type: "toggle",
        defaultValue: false,
      },
    ],
    segmentRules: [
      {
        segmentKey: "regionHost",
        fromOption: "region",
        map: {
          intl: "https://api.z.ai",
          cn: "https://open.bigmodel.cn",
        },
      },
      {
        segmentKey: "regionTag",
        fromOption: "region",
        map: {
          intl: "intl",
          cn: "cn",
        },
      },
      {
        segmentKey: "planPath",
        fromOption: "plan",
        map: {
          true: "/api/coding/paas/v4",
          false: "/api/paas/v4",
        },
      },
    ],
    variants: [
      {
        providerType: "anthropic",
        urlTemplate: "{regionHost}/api/anthropic",
        idSuffix: "{regionTag}-anthropic",
        nameSuffix: "{regionTag}-Anthropic",
      },
      {
        providerType: "openai_chat",
        urlTemplate: "{regionHost}{planPath}",
        idSuffix: "{regionTag}-openai",
        nameSuffix: "{regionTag}-OpenAI",
      },
    ],
  },
  {
    id: "xiaomi",
    nameKey: "wizard.brand.xiaomi",
    mode: "inject",
    idPrefix: "mimo",
    namePrefix: "MiMo",
    defaultModelIds: ["mimo-v2.5-pro", "mimo-v2.5"],
    defaultCustomModels: true,
    authHeader: "authorization",
    authHeaderWhen: { optionKey: "tokenPlan", equals: true },
    options: [
      {
        key: "tokenPlan",
        label: "wizard.option.tokenPlan",
        type: "toggle",
        defaultValue: false,
      },
      {
        key: "region",
        label: "wizard.option.region",
        type: "select",
        options: [
          { value: "intl", label: "wizard.region.international" },
          { value: "cn", label: "wizard.region.china" },
        ],
        defaultValue: "intl",
      },
    ],
    segmentRules: [
      {
        segmentKey: "regionTag",
        fromOption: "region",
        map: {
          intl: "intl",
          cn: "cn",
        },
      },
    ],
    compositeSegments: [
      {
        segmentKey: "host",
        optionKeys: ["tokenPlan", "region"],
        map: {
          true_intl: "https://token-plan-sgp.xiaomimimo.com",
          true_cn: "https://token-plan-cn.xiaomimimo.com",
          false_intl: "https://api.xiaomimimo.com",
          false_cn: "https://api.xiaomimimo.com",
        },
      },
    ],
    variants: [
      {
        providerType: "openai_chat",
        urlTemplate: "{host}/v1",
        idSuffix: "{regionTag}-openai",
        nameSuffix: "{regionTag}-OpenAI",
      },
      {
        providerType: "anthropic",
        urlTemplate: "{host}/anthropic",
        idSuffix: "{regionTag}-anthropic",
        nameSuffix: "{regionTag}-Anthropic",
      },
    ],
  },
  {
    id: "azure-openai",
    nameKey: "wizard.brand.azure",
    mode: "inject",
    idPrefix: "azure",
    namePrefix: "Azure-OpenAI",
    defaultModelIds: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"],
    defaultCustomModels: true,
    authHeader: "authorization",
    requireUserBaseUrl: true,
    options: [],
    segmentRules: [],
    variants: [
      {
        providerType: "openai",
        urlTemplate: "{userBaseUrl}",
        idSuffix: "gpt",
        nameSuffix: "",
      },
    ],
  },
  {
    id: "minimax",
    nameKey: "wizard.brand.minimax",
    mode: "inject",
    idPrefix: "minimax",
    namePrefix: "MiniMax",
    defaultModelIds: ["MiniMax-M2.7"],
    defaultCustomModels: true,
    options: [
      {
        key: "region",
        label: "wizard.option.region",
        type: "select",
        options: [
          { value: "intl", label: "wizard.region.international" },
          { value: "cn", label: "wizard.region.china" },
        ],
        defaultValue: "intl",
      },
    ],
    segmentRules: [
      {
        segmentKey: "regionHost",
        fromOption: "region",
        map: {
          intl: "https://api.minimax.io",
          cn: "https://api.minimaxi.com",
        },
      },
      {
        segmentKey: "regionTag",
        fromOption: "region",
        map: {
          intl: "intl",
          cn: "cn",
        },
      },
    ],
    variants: [
      {
        providerType: "openai_chat",
        urlTemplate: "{regionHost}/v1",
        idSuffix: "{regionTag}-openai",
        nameSuffix: "{regionTag}-OpenAI",
      },
      {
        providerType: "anthropic",
        urlTemplate: "{regionHost}/anthropic",
        idSuffix: "{regionTag}-anthropic",
        nameSuffix: "{regionTag}-Anthropic",
      },
    ],
  },
  {
    id: "gemini-openai",
    nameKey: "wizard.brand.geminiOpenai",
    mode: "inject",
    idPrefix: "gemini",
    namePrefix: "Gemini-OpenAI",
    defaultModelIds: ["gemini-3.1-pro-preview", "gemini-3-flash-preview"],
    defaultCustomModels: true,
    fixedBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    options: [],
    segmentRules: [],
    variants: [
      {
        providerType: "openai_chat",
        urlTemplate: "{fixedBaseUrl}",
        idSuffix: "openai",
        nameSuffix: "",
      },
    ],
  },
];

const ALL_PRESETS: readonly PartnerPreset[] = [...GENERIC_ENDPOINT_PRESETS, ...PARTNER_PRESETS];

export function getPresetById(id: string): PartnerPreset | undefined {
  return ALL_PRESETS.find(p => p.id === id);
}
