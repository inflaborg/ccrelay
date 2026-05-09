import type { AddProviderRequest, ModelMapEntry } from "../../../types/api";
import type { PartnerPreset, WizardInput } from "./types";

/** Initialize wizard option selections from preset defaults */
export function initSelections(preset: PartnerPreset): Record<string, string | boolean> {
  const s: Record<string, string | boolean> = {};
  for (const o of preset.options) {
    s[o.key] = o.defaultValue;
  }
  return s;
}

/** Serialize option value for segment map lookup */
export function stringifySelectionValue(value: string | boolean): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value;
}

/** Replace `{placeholder}` in template */
export function resolveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function mergeSelections(
  preset: PartnerPreset,
  selections: Record<string, string | boolean>
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { ...selections };
  for (const opt of preset.options) {
    if (out[opt.key] === undefined) {
      out[opt.key] = opt.defaultValue;
    }
  }
  return out;
}

export function buildTemplateValues(
  preset: PartnerPreset,
  selections: Record<string, string | boolean>,
  userBaseUrl?: string
): Record<string, string> {
  const merged = mergeSelections(preset, selections);
  const values: Record<string, string> = {};

  if (preset.fixedBaseUrl) {
    values.fixedBaseUrl = preset.fixedBaseUrl;
  }
  if (userBaseUrl?.trim()) {
    values.userBaseUrl = userBaseUrl.trim();
  }

  for (const rule of preset.segmentRules) {
    const raw = merged[rule.fromOption];
    const key = stringifySelectionValue(raw as string | boolean);
    const mapped = rule.map[key];
    if (mapped === undefined) {
      throw new Error(
        `wizard: missing segment "${rule.segmentKey}" for option "${rule.fromOption}"=${key}`
      );
    }
    values[rule.segmentKey] = mapped;
  }

  if (preset.compositeSegments) {
    for (const comp of preset.compositeSegments) {
      const parts = comp.optionKeys.map(ok =>
        stringifySelectionValue(merged[ok] as string | boolean)
      );
      const compositeKey = parts.join("_");
      const mapped = comp.map[compositeKey];
      if (mapped === undefined) {
        throw new Error(
          `wizard: missing composite segment "${comp.segmentKey}" for key "${compositeKey}"`
        );
      }
      values[comp.segmentKey] = mapped;
    }
  }

  return values;
}

export function buildModelConfig(
  modelIds: string[],
  claudeSupport: boolean,
  useCustomModels: boolean
):
  | {
      useCustomModelsList: true;
      customModelsList: string[];
      modelMap: ModelMapEntry[];
      modelMappingEnabled: true;
    }
  | {
      useCustomModelsList: false;
      modelMap: ModelMapEntry[];
      modelMappingEnabled: true;
    } {
  const trimmed = modelIds.map(s => s.trim()).filter(s => s.length > 0);

  const modelMap: ModelMapEntry[] = [];
  if (claudeSupport && trimmed.length > 0) {
    const first = trimmed[0];
    modelMap.push({ pattern: "claude-*", model: first }, { pattern: "gpt-*", model: first });
  }
  for (const id of trimmed) {
    modelMap.push({ pattern: `anthropic/${id}`, model: id });
  }

  if (useCustomModels) {
    const customModelsList = trimmed.map(id => `anthropic/${id}`);
    return {
      useCustomModelsList: true,
      customModelsList,
      modelMap,
      modelMappingEnabled: true,
    };
  }

  return {
    useCustomModelsList: false,
    modelMap,
    modelMappingEnabled: true,
  };
}

function resolveAuthHeader(
  preset: PartnerPreset,
  selections: Record<string, string | boolean>
): string | undefined {
  if (!preset.authHeader) {
    return undefined;
  }
  if (!preset.authHeaderWhen) {
    return preset.authHeader;
  }
  const { optionKey, equals } = preset.authHeaderWhen;
  const v = mergeSelections(preset, selections)[optionKey];
  if (typeof equals === "boolean") {
    return v === equals ? preset.authHeader : undefined;
  }
  return String(v) === String(equals) ? preset.authHeader : undefined;
}

export function generateProviders(preset: PartnerPreset, input: WizardInput): AddProviderRequest[] {
  if (preset.requireUserBaseUrl && !input.userBaseUrl?.trim()) {
    throw new Error("wizard: endpoint URL is required");
  }

  const templateValues = buildTemplateValues(preset, input.selections, input.userBaseUrl);
  const modelPart = buildModelConfig(input.modelIds, input.claudeSupport, input.useCustomModels);
  const authHeader = resolveAuthHeader(preset, input.selections);
  const nameRoot = input.nameBase?.trim() || preset.namePrefix;

  return preset.variants.map(variant => {
    const baseUrl = resolveTemplate(variant.urlTemplate, templateValues);
    const idSuffix = resolveTemplate(variant.idSuffix, templateValues);
    const nameSuffix = resolveTemplate(variant.nameSuffix, templateValues);

    const id = [preset.idPrefix, idSuffix].filter(s => s.length > 0).join("-");
    const nameParts = [nameRoot, nameSuffix].filter(s => s.length > 0);
    const name = nameParts.join("-");

    const req: AddProviderRequest = {
      id,
      name,
      baseUrl,
      providerType: variant.providerType,
      mode: preset.mode,
      apiKey: input.apiKey,
      enabled: true,
      ...modelPart,
      ...(variant.overrides as Partial<AddProviderRequest> | undefined),
    };

    if (authHeader) {
      req.authHeader = authHeader;
    }

    return req;
  });
}
