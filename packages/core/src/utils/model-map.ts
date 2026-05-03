/**
 * Reverse modelMap / vlModelMap: upstream id -> configured client pattern (for responses and model lists).
 */
import type { ModelMapEntry, Provider } from "../types";

export function providerHasConfigurableModelMap(provider: Provider): boolean {
  if (provider.modelMappingEnabled === false) {
    return false;
  }
  return Boolean(
    (provider.modelMap && provider.modelMap.length > 0) ||
    (provider.vlModelMap && provider.vlModelMap.length > 0)
  );
}

/**
 * If `upstreamModel` is a mapping target (`entry.model`), return `entry.pattern`.
 * Checks `modelMap` first, then `vlModelMap`. Otherwise returns `upstreamModel` unchanged.
 */
export function reverseMapMappedTargetToClientPattern(
  upstreamModel: string,
  provider: Provider
): string {
  if (provider.modelMappingEnabled === false) {
    return upstreamModel;
  }
  const lists: ModelMapEntry[][] = [];
  if (provider.modelMap?.length) {
    lists.push(provider.modelMap);
  }
  if (provider.vlModelMap?.length) {
    lists.push(provider.vlModelMap);
  }
  for (const entries of lists) {
    for (const e of entries) {
      if (e.model === upstreamModel) {
        return e.pattern;
      }
    }
  }
  return upstreamModel;
}
