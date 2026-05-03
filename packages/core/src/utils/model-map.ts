/**
 * Model list display helpers: map upstream / wire ids to client-facing labels using modelMap / vlModelMap.
 */
import type { ModelMapEntry, Provider } from "../types";
import { matchModel } from "../server/request/modelMapping";

export function providerHasConfigurableModelMap(provider: Provider): boolean {
  if (provider.modelMappingEnabled === false) {
    return false;
  }
  return Boolean(
    (provider.modelMap && provider.modelMap.length > 0) ||
    (provider.vlModelMap && provider.vlModelMap.length > 0)
  );
}

/** Patterns that are only wildcards are unusable as a stable list id (e.g. "*" → every string matches forward). */
function isDegenerateListPattern(pattern: string): boolean {
  const t = pattern.trim();
  if (t.length === 0) {
    return true;
  }
  return /^[\*\?]+$/.test(t);
}

function modelMatchesForwardRule(model: string, modelMap: ModelMapEntry[]): boolean {
  for (const entry of modelMap) {
    const { pattern } = entry;
    if (pattern === model) {
      return true;
    }
    if (pattern.includes("*") || pattern.includes("?")) {
      const patternRegex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
      if (patternRegex.test(model)) {
        return true;
      }
    }
  }
  return false;
}

function mapChains(provider: Provider): ModelMapEntry[][] {
  const lists: ModelMapEntry[][] = [];
  if (provider.modelMap?.length) {
    lists.push(provider.modelMap);
  }
  if (provider.vlModelMap?.length) {
    lists.push(provider.vlModelMap);
  }
  return lists;
}

/**
 * Map a models-list wire id to the label clients should see, when model mapping is enabled.
 *
 * 1. If `wireId` equals some `entry.model` and `entry.pattern` is not degenerate (not e.g. "*"),
 *    return that pattern (upstream id → client rule).
 * 2. Else if `wireId` matches a rule whose `pattern` is degenerate (only `*` / `?`), return that rule's
 *    `model` (same forward target as {@link matchModel}; catch-all lists collapse before dedupe).
 * 3. Else if `wireId` already matches a forward mapping rule (pattern match / exact pattern), leave it
 *    (already client-shaped; avoids bogus rewrites).
 * 4. Else return `wireId`.
 */
export function clientFacingModelIdForModelsList(wireId: string, provider: Provider): string {
  if (provider.modelMappingEnabled === false) {
    return wireId;
  }

  const chains = mapChains(provider);

  for (const entries of chains) {
    for (const e of entries) {
      if (
        e.model === wireId &&
        typeof e.pattern === "string" &&
        !isDegenerateListPattern(e.pattern)
      ) {
        return e.pattern;
      }
    }
  }

  for (const entries of chains) {
    const hit = matchModel(wireId, entries);
    if (hit && isDegenerateListPattern(hit.pattern)) {
      return hit.targetModel;
    }
  }

  for (const entries of chains) {
    if (modelMatchesForwardRule(wireId, entries)) {
      return wireId;
    }
  }

  return wireId;
}

/** @deprecated Use {@link clientFacingModelIdForModelsList} — same behavior. */
export function reverseMapMappedTargetToClientPattern(
  upstreamModel: string,
  provider: Provider
): string {
  return clientFacingModelIdForModelsList(upstreamModel, provider);
}
