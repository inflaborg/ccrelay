import { computeCanonicalAliasHash, type AliasHashProtocol } from "@ccrelay/shared/aliasHash";
import { buildCoworkModelMapEntries } from "@ccrelay/shared/coworkModelMap";
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

/**
 * Parse one `customModelsList` line into real id + display name for editor UI (alias segment ignored).
 * Supports `id`, `id;display`, `id;display;alias`, and `id;;alias`. Aligns with server `parseCustomModelLine`.
 */
export function parseCustomModelLineForUi(
  line: string
): { realId: string; displayName: string } | null {
  const s = line.trim();
  if (!s) {
    return null;
  }
  const i1 = s.indexOf(";");
  if (i1 === -1) {
    return { realId: s, displayName: "" };
  }
  const id = s.slice(0, i1).trim();
  if (!id) {
    return null;
  }
  const rest = s.slice(i1 + 1);
  const i2 = rest.indexOf(";");
  let resolvedDisplay: string;
  if (i2 === -1) {
    const displayPart = rest.trim();
    resolvedDisplay = displayPart.length > 0 ? displayPart : id;
  } else {
    const displayPart = rest.slice(0, i2).trim();
    resolvedDisplay = displayPart.length > 0 ? displayPart : id;
  }
  return { realId: id, displayName: resolvedDisplay === id ? "" : resolvedDisplay };
}

/** Non-empty lines from custom models textarea → rows for Cowork alias helper seed. */
export function helperRowsSeedFromCustomModelsText(
  text: string
): { realId: string; displayName: string }[] {
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
  const out: { realId: string; displayName: string }[] = [];
  for (const line of lines) {
    const p = parseCustomModelLineForUi(line);
    if (p) {
      out.push(p);
    }
  }
  return out;
}

/** Split wizard model line on first `;` (id;display name; empty right falls back to id). */
function parseWizardModelLine(line: string): { upstreamId: string; displayName: string } {
  const s = line.trim();
  const i = s.indexOf(";");
  if (i === -1) {
    return { upstreamId: s, displayName: s };
  }
  const upstreamId = s.slice(0, i).trim();
  const dn = s.slice(i + 1).trim();
  return { upstreamId, displayName: dn.length > 0 ? dn : upstreamId };
}

function aliasForModel(
  providerId: string,
  providerType: AliasHashProtocol,
  upstreamId: string,
  aliasPrefix: string
): string {
  return computeCanonicalAliasHash(providerId, providerType, upstreamId, aliasPrefix);
}

export interface BuildModelConfigInput {
  providerId: string;
  providerType: AliasHashProtocol;
  aliasPrefix: string;
  modelIds: string[];
  claudeSupport: boolean;
  useCustomModels: boolean;
}

export function buildModelConfig(input: BuildModelConfigInput):
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
  const { providerId, providerType, aliasPrefix, modelIds, claudeSupport, useCustomModels } = input;

  const parsed = modelIds
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(parseWizardModelLine);

  const modelMap: ModelMapEntry[] = [];

  if (useCustomModels) {
    if (claudeSupport) {
      const customModelsList = parsed.map(m => {
        const alias = aliasForModel(providerId, providerType, m.upstreamId, aliasPrefix);
        const real = m.upstreamId;
        const dn = m.displayName;
        if (dn === real) {
          return `${real};;${alias}`;
        }
        return `${real};${dn};${alias}`;
      });
      const modelMap = buildCoworkModelMapEntries(customModelsList);
      return {
        useCustomModelsList: true,
        customModelsList,
        modelMap,
        modelMappingEnabled: true,
      };
    }
    const customModelsList = parsed.map(m => {
      const real = m.upstreamId;
      const dn = m.displayName;
      return dn === real ? real : `${real};${dn}`;
    });
    return {
      useCustomModelsList: true,
      customModelsList,
      modelMap,
      modelMappingEnabled: true,
    };
  }

  if (claudeSupport && parsed.length > 0) {
    const first = parsed[0].upstreamId;
    modelMap.push({ pattern: "claude-*", model: first }, { pattern: "gpt-*", model: first });
  }
  for (const m of parsed) {
    modelMap.push({ pattern: `anthropic/${m.upstreamId}`, model: m.upstreamId });
  }

  return {
    useCustomModelsList: false,
    modelMap,
    modelMappingEnabled: true,
  };
}

/** Convert a display name into a provider ID segment (lowercase `[a-z0-9_-]`). */
export function slugifyProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function resolveProviderIdBase(
  preset: PartnerPreset,
  nameRoot: string,
  idSuffix: string,
  nameCustomized: boolean
): string {
  if (!nameCustomized) {
    return [preset.idPrefix, idSuffix].filter(s => s.length > 0).join("-");
  }
  const slug = slugifyProviderId(nameRoot);
  if (!slug) {
    return [preset.idPrefix, idSuffix].filter(s => s.length > 0).join("-");
  }
  return [slug, idSuffix].filter(s => s.length > 0).join("-");
}

function ensureUniqueProviderId(baseId: string, reserved: Set<string>): string {
  if (!reserved.has(baseId)) {
    reserved.add(baseId);
    return baseId;
  }
  let n = 2;
  while (reserved.has(`${baseId}-${n}`)) {
    n++;
  }
  const unique = `${baseId}-${n}`;
  reserved.add(unique);
  return unique;
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
  const aliasPrefix = input.aliasPrefix ?? "claude-";
  const authHeader = resolveAuthHeader(preset, input.selections);
  const trimmedNameBase = input.nameBase?.trim();
  const nameRoot = trimmedNameBase || preset.namePrefix;
  const nameCustomized = Boolean(trimmedNameBase && trimmedNameBase !== preset.namePrefix);
  const reservedIds = new Set(input.existingProviderIds ?? []);

  return preset.variants.map(variant => {
    const baseUrl = resolveTemplate(variant.urlTemplate, templateValues);
    const idSuffix = resolveTemplate(variant.idSuffix, templateValues);
    const nameSuffix = resolveTemplate(variant.nameSuffix, templateValues);

    const idBase = resolveProviderIdBase(preset, nameRoot, idSuffix, nameCustomized);
    const id = ensureUniqueProviderId(idBase, reservedIds);
    const nameParts = [nameRoot, nameSuffix].filter(s => s.length > 0);
    const name = nameParts.join("-");

    const modelPart = buildModelConfig({
      providerId: id,
      providerType: variant.providerType,
      aliasPrefix,
      modelIds: input.modelIds,
      claudeSupport: input.claudeSupport,
      useCustomModels: input.useCustomModels,
    });

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
