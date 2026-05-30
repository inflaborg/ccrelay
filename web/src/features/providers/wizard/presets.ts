import type { PartnerPreset } from "./types";
import { partnerPresetSortIndex } from "../providerSortOrder";

/** Known vendor tokens → preferred display casing */
const VENDOR_DISPLAY: Record<string, string> = {
  glm: "GLM",
  gpt: "GPT",
  mimo: "MiMo",
  minimax: "MiniMax",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  claude: "Claude",
  llama: "Llama",
  qwen: "Qwen",
};

/**
 * Turn an upstream model id (hyphen-separated) into a human display name:
 * hyphen → space; known vendors (glm, gpt, …) use brand casing; numeric / version-like segments kept readable.
 */
export function upstreamModelIdToDisplayName(upstreamId: string): string {
  const id = upstreamId.trim();
  if (!id) {
    return id;
  }
  return id
    .split("-")
    .map(part => displayNameSegment(part))
    .filter(s => s.length > 0)
    .join(" ");
}

function displayNameSegment(part: string): string {
  const trimmed = part.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[\d.]+$/.test(trimmed)) {
    return trimmed;
  }
  if (/^v[\d.]+$/i.test(trimmed)) {
    return "V" + trimmed.slice(1).toLowerCase();
  }
  if (/[a-z][A-Z]/.test(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (VENDOR_DISPLAY[lower]) {
    return VENDOR_DISPLAY[lower];
  }
  if (/^[a-z]+$/i.test(trimmed)) {
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** One wizard textarea line: ensure `id;display` with generated display when display is empty. */
function expandWizardModelLineDefault(line: string): string {
  const s = line.trim();
  if (!s) {
    return s;
  }
  const i = s.indexOf(";");
  if (i === -1) {
    return `${s};${upstreamModelIdToDisplayName(s)}`;
  }
  const id = s.slice(0, i).trim();
  const dn = s.slice(i + 1).trim();
  if (!id) {
    return s;
  }
  if (dn.length === 0) {
    return `${id};${upstreamModelIdToDisplayName(id)}`;
  }
  return `${id};${dn}`;
}

/** Newline-separated default model list for textarea value / placeholder */
export function defaultModelIdsAsText(preset: PartnerPreset): string {
  return preset.defaultModelIds.map(expandWizardModelLineDefault).join("\n");
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

const PARTNER_PRESETS_LIST: PartnerPreset[] = [
  {
    id: "tuning-engines",
    nameKey: "wizard.brand.tuningEngines",
    mode: "inject",
    idPrefix: "tuning-engines",
    namePrefix: "Tuning-Engines",
    defaultModelIds: ["llama-3.3-70b-fp8", "qwen-2.5-coder-32b"],
    defaultCustomModels: true,
    authHeader: "authorization",
    fixedBaseUrl: "https://api.tuningengines.com/v1",
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
  {
    id: "astraflow",
    nameKey: "wizard.brand.astraflow",
    mode: "inject",
    idPrefix: "astraflow",
    namePrefix: "Astraflow",
    defaultModelIds: [],
    defaultCustomModels: true,
    authHeader: "authorization",
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
          intl: "https://api-us-ca.umodelverse.ai",
          cn: "https://api.modelverse.cn",
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
    ],
  },
  {
    id: "deepseek",
    nameKey: "wizard.brand.deepseek",
    mode: "inject",
    idPrefix: "deepseek",
    namePrefix: "DeepSeek",
    defaultModelIds: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultCustomModels: true,
    fixedBaseUrl: "https://api.deepseek.com/v1",
    options: [],
    segmentRules: [],
    variants: [
      {
        providerType: "openai_chat",
        urlTemplate: "{fixedBaseUrl}",
        idSuffix: "openai",
        nameSuffix: "-OpenAI",
      },
      {
        providerType: "anthropic",
        urlTemplate: "https://api.deepseek.com/anthropic",
        idSuffix: "anthropic",
        nameSuffix: "-Anthropic",
      },
    ],
  },
];

/** Partner vendors (合作商) in product display order. */
export const PARTNER_PRESETS: readonly PartnerPreset[] = [...PARTNER_PRESETS_LIST].sort(
  (a, b) => partnerPresetSortIndex(a.id) - partnerPresetSortIndex(b.id)
);

const ALL_PRESETS: readonly PartnerPreset[] = [...GENERIC_ENDPOINT_PRESETS, ...PARTNER_PRESETS];

export function getPresetById(id: string): PartnerPreset | undefined {
  return ALL_PRESETS.find(p => p.id === id);
}
