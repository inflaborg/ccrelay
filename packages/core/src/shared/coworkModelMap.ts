import { parseCustomModelLine } from "./customModelsLine";

export interface CoworkModelMapEntry {
  pattern: string;
  model: string;
}

/** Claude family wildcards inserted before catch-all `claude-*` / `gpt-*`. */
export const CLAUDE_FAMILY_WILDCARDS = [
  "claude-haiku-*",
  "claude-sonnet-*",
  "claude-opus-*",
] as const;

export type ClaudeFamilyWildcard = (typeof CLAUDE_FAMILY_WILDCARDS)[number];

export type ClaudeFamilyTargets = Partial<Record<ClaudeFamilyWildcard, string>>;

export interface BuildCoworkModelMapOptions {
  /** Wildcard catch-all target model; defaults to first customModelsList id. */
  wildcardTargetModel?: string;
  /** Per-family Claude wildcard targets. Missing keys default to first custom model id. */
  claudeFamilyTargets?: ClaudeFamilyTargets;
}

export interface RebuildCoworkModelMapInput {
  customModelsList: string[];
  /** Preserves Claude family wildcard targets when those models still exist. */
  existingModelMap?: CoworkModelMapEntry[];
  /** @deprecated ignored — aliases are read from customModelsList lines */
  aliasPrefix?: string;
  wildcardTargetModel?: string;
}

/**
 * Keep Claude family wildcard targets from an existing map when the target id is still valid.
 */
export function extractClaudeFamilyTargets(
  existingModelMap: CoworkModelMapEntry[] | undefined,
  validModelIds?: Set<string>
): ClaudeFamilyTargets {
  const out: ClaudeFamilyTargets = {};
  if (!existingModelMap?.length) {
    return out;
  }
  for (const pattern of CLAUDE_FAMILY_WILDCARDS) {
    const found = existingModelMap.find(e => e.pattern === pattern);
    if (!found?.model) {
      continue;
    }
    if (validModelIds && !validModelIds.has(found.model)) {
      continue;
    }
    out[pattern] = found.model;
  }
  return out;
}

/**
 * Build Cowork modelMap: alias exact rules, identity exact rules, Claude family wildcards,
 * then default catch-alls.
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
    for (const pattern of CLAUDE_FAMILY_WILDCARDS) {
      const target = options?.claudeFamilyTargets?.[pattern];
      const model = target && identityIds.has(target) ? target : (firstId ?? wildcardTarget);
      entries.push({ pattern, model });
    }
    entries.push(
      { pattern: "claude-*", model: wildcardTarget },
      { pattern: "gpt-*", model: wildcardTarget }
    );
  }

  return entries;
}

/**
 * Rebuild Cowork modelMap from customModelsList. Claude family wildcard targets are kept
 * when they still point at a listed model; other custom rules are not preserved.
 */
export function rebuildCoworkModelMap(input: RebuildCoworkModelMapInput): CoworkModelMapEntry[] {
  const validIds = new Set<string>();
  for (const line of input.customModelsList) {
    const parsed = parseCustomModelLine(line);
    if (parsed.id) {
      validIds.add(parsed.id);
    }
  }
  return buildCoworkModelMapEntries(input.customModelsList, {
    wildcardTargetModel: input.wildcardTargetModel,
    claudeFamilyTargets: extractClaudeFamilyTargets(input.existingModelMap, validIds),
  });
}
