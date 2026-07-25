import { minimatch } from "../../utils/helpers";
import { cloneModelMeta, GLOBAL_UNKNOWN_MODEL_META, VENDOR_DEFAULT_META } from "./defaults";
import { ANTHROPIC_MODEL_FAMILIES } from "./families.anthropic";
import { DEEPSEEK_MODEL_FAMILIES } from "./families.deepseek";
import { GEMINI_MODEL_FAMILIES } from "./families.gemini";
import { GLM_MODEL_FAMILIES } from "./families.glm";
import { GROK_MODEL_FAMILIES } from "./families.grok";
import { KIMI_MODEL_FAMILIES } from "./families.kimi";
import { LONGCAT_MODEL_FAMILIES } from "./families.longcat";
import { MIMO_MODEL_FAMILIES } from "./families.mimo";
import { OPENAI_MODEL_FAMILIES } from "./families.openai";
import type {
  ModelFamilyEntry,
  ModelInputModality,
  ModelMeta,
  ModelVendor,
  ResolveModelMetaOptions,
} from "./types";

const ALL_FAMILIES: readonly ModelFamilyEntry[] = [
  ...MIMO_MODEL_FAMILIES,
  ...LONGCAT_MODEL_FAMILIES,
  ...GROK_MODEL_FAMILIES,
  ...GLM_MODEL_FAMILIES,
  ...KIMI_MODEL_FAMILIES,
  ...ANTHROPIC_MODEL_FAMILIES,
  ...OPENAI_MODEL_FAMILIES,
  ...GEMINI_MODEL_FAMILIES,
  ...DEEPSEEK_MODEL_FAMILIES,
];

function familyPatterns(entry: ModelFamilyEntry): readonly string[] {
  const m = entry.match;
  if (typeof m === "string") {
    return m.length > 0 ? [m] : [];
  }
  return m;
}

function entryMatchesModel(entry: ModelFamilyEntry, modelId: string): boolean {
  if (entry.matchRegex?.test(modelId)) {
    return true;
  }
  for (const pattern of familyPatterns(entry)) {
    if (minimatch(modelId, pattern)) {
      return true;
    }
  }
  return false;
}

function syncVisionFromInput(meta: ModelMeta): ModelMeta {
  const wantsImage = meta.input.modalities.includes("image");
  if (meta.vision.enabled === wantsImage) {
    return meta;
  }
  return { ...meta, vision: { enabled: wantsImage } };
}

function mergeMeta(base: ModelMeta, patch: Partial<Omit<ModelMeta, "id" | "vendor">>): ModelMeta {
  const out = cloneModelMeta(base);
  if (patch.input?.modalities) {
    const modalities: ModelInputModality[] = [...patch.input.modalities];
    if (!modalities.includes("text")) {
      modalities.unshift("text");
    }
    out.input = { modalities };
    out.vision = { enabled: modalities.includes("image") };
  }
  if (patch.reasoning) {
    out.reasoning = { ...out.reasoning, ...patch.reasoning };
  }
  if (patch.vision && !patch.input?.modalities) {
    out.vision = { ...out.vision, ...patch.vision };
    const mods = new Set<ModelInputModality>(out.input.modalities);
    if (out.vision.enabled) {
      mods.add("image");
    } else {
      mods.delete("image");
    }
    mods.add("text");
    out.input = { modalities: [...mods] };
  }
  if (patch.openaiChat) {
    out.openaiChat = { ...(out.openaiChat ?? {}), ...patch.openaiChat };
  }
  if (patch.gemini) {
    out.gemini = { ...(out.gemini ?? {}), ...patch.gemini };
  }
  if (patch.deepseek) {
    out.deepseek = { ...(out.deepseek ?? {}), ...patch.deepseek };
  }
  if (patch.anthropic) {
    out.anthropic = { ...(out.anthropic ?? {}), ...patch.anthropic };
  }
  return syncVisionFromInput(out);
}

function familyToMeta(entry: ModelFamilyEntry, modelId: string): ModelMeta {
  let meta = syncVisionFromInput(
    cloneModelMeta({
      id: entry.id,
      vendor: entry.vendor,
      ...entry.meta,
    })
  );

  if (entry.overrides) {
    for (const override of entry.overrides) {
      if (override.match.toLowerCase() === modelId) {
        meta = mergeMeta(meta, override.patch);
      }
    }
  }

  return meta;
}

function resolveFromFamilies(modelId: string, vendor?: ModelVendor): ModelMeta | null {
  const candidates = vendor ? ALL_FAMILIES.filter(f => f.vendor === vendor) : ALL_FAMILIES;

  for (const entry of candidates) {
    if (entryMatchesModel(entry, modelId)) {
      return familyToMeta(entry, modelId);
    }
  }

  return null;
}

/**
 * Resolve static capability metadata for a wire model id (after provider model mapping).
 * Safe for browser bundles (no Node logger dependency).
 */
export function resolveModelMeta(modelId: string, options?: ResolveModelMetaOptions): ModelMeta {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return cloneModelMeta(GLOBAL_UNKNOWN_MODEL_META);
  }

  const fromFamily = resolveFromFamilies(normalized, options?.vendor);
  if (fromFamily) {
    return fromFamily;
  }

  if (options?.vendor && options.vendor !== "generic") {
    const vendorDefault = VENDOR_DEFAULT_META[options.vendor];
    if (vendorDefault) {
      return cloneModelMeta({ ...vendorDefault, id: `${options.vendor}-default` });
    }
  }

  return cloneModelMeta(GLOBAL_UNKNOWN_MODEL_META);
}

/** Whether the model accepts image input (multimodal). */
export function modelSupportsImageInput(
  modelId: string,
  options?: ResolveModelMetaOptions
): boolean {
  return resolveModelMeta(modelId, options).input.modalities.includes("image");
}

/** @internal Tests and registry introspection. */
export function listModelFamilies(): readonly ModelFamilyEntry[] {
  return ALL_FAMILIES;
}
