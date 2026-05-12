import type { Provider, ProviderConfigInput } from "../types";

/**
 * Parse provider from validated config
 */
export function parseProvider(id: string, config: ProviderConfigInput): Provider {
  // Support both camelCase and snake_case variants
  const baseUrl = config.baseUrl || config.base_url || "";
  const apiKey = config.apiKey || config.api_key;
  const authHeader = config.authHeader || config.auth_header;
  const modelMap = config.modelMap || config.model_map;
  const vlModelMap = config.vlModelMap || config.vl_model_map;
  const providerType = config.providerType || config.provider_type || "anthropic";
  const useCustomModelsList =
    config.useCustomModelsList === true || config.use_custom_models_list === true;
  const rawList = config.customModelsList ?? config.custom_models_list;
  const customModelsListNormalized = Array.isArray(rawList) ? rawList : undefined;
  const openaiCompat = config.openaiCompat ?? config.openai_compat;
  const modelMappingExplicitlyDisabled =
    config.modelMappingEnabled === false || config.model_mapping_enabled === false;

  return {
    id,
    name: config.name || id,
    baseUrl,
    mode: config.mode,
    providerType,
    apiKey,
    authHeader: authHeader || "authorization",
    modelMap: modelMap && modelMap.length > 0 ? modelMap : undefined,
    vlModelMap: vlModelMap && vlModelMap.length > 0 ? vlModelMap : undefined,
    headers: config.headers ?? {},
    // `official` is always on; YAML may be hand-edited to false
    enabled: id === "official" ? true : config.enabled !== false,
    ...(useCustomModelsList
      ? {
          useCustomModelsList: true,
          customModelsList: customModelsListNormalized ?? [],
        }
      : {}),
    ...(openaiCompat !== undefined ? { openaiCompat } : {}),
    ...(modelMappingExplicitlyDisabled ? { modelMappingEnabled: false } : {}),
  };
}

/**
 * Rebuild a providers map with stable key order for YAML: `official` first when present,
 * then remaining ids sorted with English locale and numeric awareness.
 */
export function sortProviderMapKeys<T>(providers: Record<string, T>): Record<string, T> {
  const keys = Object.keys(providers);
  if (keys.length === 0) {
    return {};
  }
  const rest = keys.filter(k => k !== "official");
  rest.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }));
  const ordered = keys.includes("official") ? (["official", ...rest] as const) : rest;
  const out: Record<string, T> = {};
  for (const k of ordered) {
    out[k] = providers[k];
  }
  return out;
}

/**
 * Map duplicate-style ids to a common base: `x_copy` vs `xCopy` vs `xcopy` (long ids).
 * Used only to pair **one** request id with the canonical YAML key (duplicate workflow).
 */
export function providerIdFuzzyBaseForDuplicateKey(id: string): string {
  if (id.length < 1) {
    return id;
  }
  if (/_copy$/i.test(id)) {
    return id.replace(/_copy$/i, "");
  }
  if (id.length > 4 && /Copy$/.test(id)) {
    return id.slice(0, -4);
  }
  if (id.length >= 10 && /copy$/i.test(id)) {
    return id.slice(0, -4);
  }
  return id;
}

/** True for ids that look like a duplicate of another (never the bare source id by itself). */
export function isDuplicateStyleProviderId(id: string): boolean {
  if (/_copy$/i.test(id)) {
    return true;
  }
  if (id.length > 4 && /Copy$/.test(id)) {
    return true;
  }
  if (id.length >= 10 && /copy$/i.test(id)) {
    return true;
  }
  return false;
}

/**
 * Map a requested provider id (from URL) to the exact key in a providers map.
 * Handles decodeURIComponent, trim, Unicode NFC, and a single case-insensitive match
 * (some stacks alter path segment casing; YAML keys are case-sensitive).
 * Also matches duplicate variants: e.g. `local-hysp-llm-routerCopy` in the URL
 * to YAML key `local-hysp-llm-router_copy` when the fuzzy base is unique in the file.
 */
export function resolveProviderKeyInMap(mapKeys: string[], requestedId: string): string | null {
  let q: string;
  try {
    q = decodeURIComponent(requestedId).trim();
  } catch {
    q = requestedId.trim();
  }
  if (!q) {
    return null;
  }
  if (mapKeys.includes(q)) {
    return q;
  }
  const nfcQ = q.normalize("NFC");
  for (const k of mapKeys) {
    if (k === q || k.normalize("NFC") === nfcQ) {
      return k;
    }
  }
  const low = q.toLowerCase();
  const byCase = mapKeys.filter(k => k.toLowerCase() === low);
  if (byCase.length === 1) {
    return byCase[0] ?? null;
  }
  if (isDuplicateStyleProviderId(q)) {
    const bq = providerIdFuzzyBaseForDuplicateKey(q);
    const byFuzzy = mapKeys.filter(k => {
      if (providerIdFuzzyBaseForDuplicateKey(k) !== bq) {
        return false;
      }
      return isDuplicateStyleProviderId(k);
    });
    if (byFuzzy.length === 1) {
      return byFuzzy[0] ?? null;
    }
  }
  return null;
}
