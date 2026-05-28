import { parseCustomModelLine } from "./customModelsLine";

export interface CoworkModelMapEntry {
  pattern: string;
  model: string;
}

export interface BuildCoworkModelMapOptions {
  /** Wildcard catch-all target model; defaults to first customModelsList id. */
  wildcardTargetModel?: string;
}

export interface RebuildCoworkModelMapInput {
  customModelsList: string[];
  /** @deprecated ignored — rebuild is clear-and-rebuild from customModelsList only */
  existingModelMap?: CoworkModelMapEntry[];
  /** @deprecated ignored — aliases are read from customModelsList lines */
  aliasPrefix?: string;
  wildcardTargetModel?: string;
}

/**
 * Build Cowork modelMap: alias exact rules, identity exact rules, then default wildcards.
 */
export function buildCoworkModelMapEntries(
  customModelsList: string[],
  options?: BuildCoworkModelMapOptions
): CoworkModelMapEntry[] {
  const entries: CoworkModelMapEntry[] = [];
  const identityIds = new Set<string>();
  let firstId: string | undefined;

  for (const line of customModelsList) {
    const parsed = parseCustomModelLine(line);
    if (!parsed.id) {
      continue;
    }
    if (firstId === undefined) {
      firstId = parsed.id;
    }
    if (parsed.alias !== parsed.id) {
      entries.push({ pattern: parsed.alias, model: parsed.id });
    }
    if (!identityIds.has(parsed.id)) {
      identityIds.add(parsed.id);
      entries.push({ pattern: parsed.id, model: parsed.id });
    }
  }

  const wildcardTarget = options?.wildcardTargetModel ?? firstId;
  if (wildcardTarget) {
    entries.push(
      { pattern: "claude-*", model: wildcardTarget },
      { pattern: "gpt-*", model: wildcardTarget }
    );
  }

  return entries;
}

/**
 * Clear-and-rebuild Cowork modelMap from customModelsList (does not preserve custom rules).
 */
export function rebuildCoworkModelMap(input: RebuildCoworkModelMapInput): CoworkModelMapEntry[] {
  return buildCoworkModelMapEntries(input.customModelsList, {
    wildcardTargetModel: input.wildcardTargetModel,
  });
}
