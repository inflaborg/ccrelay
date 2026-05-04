/**
 * Helpers for model-map configuration (request-body mapping lives in modelMapping.ts).
 */
import type { Provider } from "../types";

export function providerHasConfigurableModelMap(provider: Provider): boolean {
  if (provider.modelMappingEnabled === false) {
    return false;
  }
  return Boolean(
    (provider.modelMap && provider.modelMap.length > 0) ||
    (provider.vlModelMap && provider.vlModelMap.length > 0)
  );
}
