import { minimatch } from "../../utils/helpers";
import { ScopedLogger } from "../../utils/logger";
import { cloneModelMeta, GLOBAL_UNKNOWN_MODEL_META, VENDOR_DEFAULT_META } from "./defaults";
import { ANTHROPIC_MODEL_FAMILIES } from "./families.anthropic";
import { DEEPSEEK_MODEL_FAMILIES } from "./families.deepseek";
import { GEMINI_MODEL_FAMILIES } from "./families.gemini";
import { GLM_MODEL_FAMILIES } from "./families.glm";
import { OPENAI_MODEL_FAMILIES } from "./families.openai";
import type { ModelFamilyEntry, ModelMeta, ModelVendor, ResolveModelMetaOptions } from "./types";

const log = new ScopedLogger("ModelMeta");

const ALL_FAMILIES: readonly ModelFamilyEntry[] = [
  ...GLM_MODEL_FAMILIES,
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

function mergeMeta(base: ModelMeta, patch: Partial<Omit<ModelMeta, "id" | "vendor">>): ModelMeta {
  const out = cloneModelMeta(base);
  if (patch.reasoning) {
    out.reasoning = { ...out.reasoning, ...patch.reasoning };
  }
  if (patch.vision) {
    out.vision = { ...out.vision, ...patch.vision };
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
  return out;
}

function familyToMeta(entry: ModelFamilyEntry, modelId: string): ModelMeta {
  let meta = cloneModelMeta({
    id: entry.id,
    vendor: entry.vendor,
    ...entry.meta,
  });

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
 */
export function resolveModelMeta(modelId: string, options?: ResolveModelMetaOptions): ModelMeta {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    log.warn("[model-meta] empty model id; using unknown fallback");
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

  log.warn(`[model-meta] no family match for "${normalized}"; using conservative unknown fallback`);
  return cloneModelMeta(GLOBAL_UNKNOWN_MODEL_META);
}

/** @internal Tests and registry introspection. */
export function listModelFamilies(): readonly ModelFamilyEntry[] {
  return ALL_FAMILIES;
}
