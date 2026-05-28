import { looksLikeLegacyAliasPattern } from "./aliasHash";
import { parseCustomModelLine } from "./customModelsLine";

export interface CoworkModelMapEntry {
  pattern: string;
  model: string;
}

export interface RebuildCoworkModelMapInput {
  customModelsList: string[];
  existingModelMap?: CoworkModelMapEntry[];
  aliasPrefix?: string;
}

/**
 * Rebuild Cowork modelMap from customModelsList: exact alias rules, preserved wildcards,
 * custom non-alias patterns, stale alias-shaped patterns removed.
 */
export function rebuildCoworkModelMap(input: RebuildCoworkModelMapInput): CoworkModelMapEntry[] {
  const aliasPrefix = input.aliasPrefix ?? "claude-";
  const existing = input.existingModelMap ?? [];

  const exactRules: CoworkModelMapEntry[] = [];
  const currentAliases = new Set<string>();

  for (const line of input.customModelsList) {
    const parsed = parseCustomModelLine(line);
    if (!parsed.id || parsed.alias === parsed.id) {
      continue;
    }
    currentAliases.add(parsed.alias);
    exactRules.push({ pattern: parsed.alias, model: parsed.id });
  }

  const wildcards: CoworkModelMapEntry[] = [];
  for (const entry of existing) {
    if (entry.pattern === "claude-*" || entry.pattern === "gpt-*") {
      if (!wildcards.some(w => w.pattern === entry.pattern)) {
        wildcards.push({ ...entry });
      }
    }
  }

  const preservedCustom: CoworkModelMapEntry[] = [];
  for (const entry of existing) {
    if (entry.pattern === "claude-*" || entry.pattern === "gpt-*") {
      continue;
    }
    if (currentAliases.has(entry.pattern)) {
      continue;
    }
    if (looksLikeLegacyAliasPattern(entry.pattern, aliasPrefix)) {
      continue;
    }
    if (preservedCustom.some(p => p.pattern === entry.pattern && p.model === entry.model)) {
      continue;
    }
    preservedCustom.push({ ...entry });
  }

  return [...exactRules, ...preservedCustom, ...wildcards];
}
