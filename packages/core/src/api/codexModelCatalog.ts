/**
 * Codex model catalog generation for ~/.codex/ccrelay-model-catalog.json
 * and model_catalog_json pointer in config.toml.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Provider, ProviderType, SmartRoutingCatalogEntry } from "../types";
import { collectParsedCustomModelsDeduped } from "../converter/models-fallback";
import { buildSmartRoutingModelDisplayName } from "../server/smartRouting/synthesizeModels";

export const CCRELAY_CODEX_MODEL_CATALOG_FILENAME = "ccrelay-model-catalog.json";

/**
 * Bump when generated catalog fields change in a way that existing files must be rewritten.
 * Files without this field are treated as version 0.
 */
export const CCRELAY_CODEX_CATALOG_SCHEMA_VERSION = 3;

/** Read a top-level TOML string key without importing the full clientConfig parser. */
function readTopLevelTomlString(content: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m");
  const m = content.match(re);
  if (!m) {
    return undefined;
  }
  let val = m[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

export interface CodexCatalogModelRef {
  slug: string;
  displayName: string;
  protocol?: ProviderType;
}

/** `all` treats every catalog model as vision. Otherwise only `modelIds` accept images. */
export interface CodexCatalogVision {
  all: boolean;
  modelIds: string[];
}

export const DEFAULT_CODEX_CATALOG_VISION: CodexCatalogVision = { all: true, modelIds: [] };

/** Protocols and individual slugs left out of the Codex catalog. */
export interface CodexCatalogExclude {
  protocols: ProviderType[];
  modelIds: string[];
}

export const DEFAULT_CODEX_CATALOG_EXCLUDE: CodexCatalogExclude = { protocols: [], modelIds: [] };

const CODEX_PROTOCOLS: readonly ProviderType[] = ["anthropic", "openai", "openai_chat"];

const DEFAULT_CONTEXT_WINDOW = 128_000;

const BASE_INSTRUCTIONS =
  "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.";

/**
 * Efforts Codex can offer in `/model`. An empty list makes the picker fall back
 * to the client default (Medium) and hides `default_reasoning_level`.
 * `max` / `ultra` are omitted: they imply OpenAI multi-agent delegation.
 */
const CODEX_REASONING_LEVELS: ReadonlyArray<{ effort: string; description: string }> = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  { effort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { effort: "high", description: "Greater reasoning depth for complex problems" },
  { effort: "xhigh", description: "Extra high reasoning depth for complex problems" },
];

/** Minimal Codex catalog entry fields required for /model listing. */
function catalogEntryTemplate(
  slug: string,
  displayName: string,
  priority: number,
  supportsImage: boolean
): object {
  /* eslint-disable @typescript-eslint/naming-convention -- Codex catalog JSON uses snake_case */
  return {
    slug,
    display_name: displayName,
    description: displayName,
    base_instructions: BASE_INSTRUCTIONS,
    default_reasoning_level: "high",
    supported_reasoning_levels: CODEX_REASONING_LEVELS.map(level => ({ ...level })),
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 1000 + priority,
    // Older Codex gates the whole `reasoning` object (including effort) on this flag.
    // `default_reasoning_summary: none` still omits `reasoning.summary` on the wire.
    supports_reasoning_summaries: true,
    default_reasoning_summary: "none",
    support_verbosity: false,
    supports_parallel_tool_calls: false,
    supports_image_detail_original: false,
    context_window: DEFAULT_CONTEXT_WINDOW,
    max_context_window: DEFAULT_CONTEXT_WINDOW,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: supportsImage ? ["text", "image"] : ["text"],
    supports_search_tool: false,
    truncation_policy: { mode: "tokens", limit: 10000 },
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

function isWildcardPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/**
 * Collect models for Codex catalog from the active provider.
 * Priority: customModelsList → exact modelMap patterns → fallbackModel.
 */
export function collectCodexModelsFromProvider(
  provider: Provider | null | undefined,
  fallbackModel?: string
): CodexCatalogModelRef[] {
  const seen = new Set<string>();
  const out: CodexCatalogModelRef[] = [];

  const push = (slug: string, displayName: string, protocol?: ProviderType) => {
    const s = slug.trim();
    if (!s || seen.has(s)) {
      return;
    }
    seen.add(s);
    const d = displayName.trim() || s;
    out.push(protocol ? { slug: s, displayName: d, protocol } : { slug: s, displayName: d });
  };

  const protocol = provider?.providerType;

  if (provider?.customModelsList && provider.customModelsList.length > 0) {
    for (const parsed of collectParsedCustomModelsDeduped(provider.customModelsList)) {
      push(parsed.id, parsed.displayName, protocol);
    }
  } else if (provider?.modelMap && provider.modelMappingEnabled !== false) {
    for (const entry of provider.modelMap) {
      const pattern = entry.pattern?.trim() ?? "";
      if (!pattern || isWildcardPattern(pattern)) {
        continue;
      }
      push(pattern, pattern, protocol);
    }
  }

  const fallback = fallbackModel?.trim();
  if (fallback) {
    push(fallback, fallback);
  }

  return out;
}

/**
 * When smart routing is the active route, Codex should list those models, not the
 * selected provider. Slugs are `providerId:model` so a bare name is not ambiguous.
 */
export function collectCodexModelsFromSmartRouting(
  entries: readonly SmartRoutingCatalogEntry[],
  fallbackModel?: string
): CodexCatalogModelRef[] {
  const seen = new Set<string>();
  const out: CodexCatalogModelRef[] = [];

  const push = (slug: string, displayName: string, protocol?: ProviderType) => {
    const s = slug.trim();
    if (!s || seen.has(s)) {
      return;
    }
    seen.add(s);
    const d = displayName.trim() || s;
    out.push(protocol ? { slug: s, displayName: d, protocol } : { slug: s, displayName: d });
  };

  for (const entry of entries) {
    push(entry.publicId, buildSmartRoutingModelDisplayName(entry), entry.protocol);
  }

  const fallback = fallbackModel?.trim();
  if (fallback) {
    push(fallback, fallback);
  }

  return out;
}

export function codexModelSupportsVision(slug: string, vision: CodexCatalogVision): boolean {
  return vision.all || vision.modelIds.includes(slug);
}

export function applyCodexCatalogExclusions(
  models: readonly CodexCatalogModelRef[],
  exclude: CodexCatalogExclude = DEFAULT_CODEX_CATALOG_EXCLUDE
): CodexCatalogModelRef[] {
  const protocols = new Set(exclude.protocols);
  const ids = new Set(exclude.modelIds);
  return models.filter(model => {
    if (ids.has(model.slug)) {
      return false;
    }
    return !(model.protocol && protocols.has(model.protocol));
  });
}

/* eslint-disable @typescript-eslint/naming-convention -- Codex catalog JSON uses snake_case */
interface CodexCatalogFile {
  catalog_schema_version: number;
  vision_all: boolean;
  vision_model_ids: string[];
  exclude_protocols: ProviderType[];
  exclude_model_ids: string[];
  models: object[];
}
/* eslint-enable @typescript-eslint/naming-convention */

/* eslint-disable @typescript-eslint/naming-convention -- Codex catalog JSON uses snake_case */
export function buildCodexModelCatalogJson(
  models: CodexCatalogModelRef[],
  vision: CodexCatalogVision = DEFAULT_CODEX_CATALOG_VISION,
  exclude: CodexCatalogExclude = DEFAULT_CODEX_CATALOG_EXCLUDE
): CodexCatalogFile {
  const included = applyCodexCatalogExclusions(models, exclude);
  return {
    catalog_schema_version: CCRELAY_CODEX_CATALOG_SCHEMA_VERSION,
    vision_all: vision.all,
    vision_model_ids: vision.all ? [] : vision.modelIds,
    exclude_protocols: exclude.protocols,
    exclude_model_ids: exclude.modelIds,
    models: included.map((m, i) =>
      catalogEntryTemplate(m.slug, m.displayName, i, codexModelSupportsVision(m.slug, vision))
    ),
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/** Version stamped in the CCRelay catalog file, or null when the file is missing or unreadable. 0 means an older file with no stamp. */
export function readCodexCatalogSchemaVersion(codexDir: string = codexConfigDir()): number | null {
  const catalogPath = codexModelCatalogPath(codexDir);
  if (!fs.existsSync(catalogPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Partial<CodexCatalogFile>;
    return typeof parsed.catalog_schema_version === "number" ? parsed.catalog_schema_version : 0;
  } catch {
    return 0;
  }
}

export function readCodexCatalogVision(codexDir: string = codexConfigDir()): CodexCatalogVision {
  const catalogPath = codexModelCatalogPath(codexDir);
  if (!fs.existsSync(catalogPath)) {
    return { ...DEFAULT_CODEX_CATALOG_VISION };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Partial<CodexCatalogFile>;
    if (parsed.vision_all === false) {
      const modelIds = Array.isArray(parsed.vision_model_ids)
        ? parsed.vision_model_ids.filter(
            (id): id is string => typeof id === "string" && id.trim() !== ""
          )
        : [];
      return { all: false, modelIds };
    }
    return { all: true, modelIds: [] };
  } catch {
    return { ...DEFAULT_CODEX_CATALOG_VISION };
  }
}

function isProviderType(value: string): value is ProviderType {
  return (CODEX_PROTOCOLS as readonly string[]).includes(value);
}

export function readCodexCatalogExclude(codexDir: string = codexConfigDir()): CodexCatalogExclude {
  const catalogPath = codexModelCatalogPath(codexDir);
  if (!fs.existsSync(catalogPath)) {
    return { protocols: [], modelIds: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Partial<CodexCatalogFile>;
    const protocols = Array.isArray(parsed.exclude_protocols)
      ? parsed.exclude_protocols.filter(isProviderType)
      : [];
    const modelIds = Array.isArray(parsed.exclude_model_ids)
      ? parsed.exclude_model_ids.filter(
          (id): id is string => typeof id === "string" && id.trim() !== ""
        )
      : [];
    return { protocols, modelIds };
  } catch {
    return { protocols: [], modelIds: [] };
  }
}

export function codexConfigDir(): string {
  return path.join(os.homedir(), ".codex");
}

export function codexModelCatalogPath(codexDir: string = codexConfigDir()): string {
  return path.join(codexDir, CCRELAY_CODEX_MODEL_CATALOG_FILENAME);
}

export function writeCodexModelCatalog(
  models: CodexCatalogModelRef[],
  codexDir: string = codexConfigDir(),
  vision?: CodexCatalogVision,
  exclude?: CodexCatalogExclude
): string {
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const catalogPath = codexModelCatalogPath(codexDir);
  const resolvedVision = vision ?? readCodexCatalogVision(codexDir);
  const resolvedExclude = exclude ?? readCodexCatalogExclude(codexDir);
  const body = buildCodexModelCatalogJson(models, resolvedVision, resolvedExclude);
  fs.writeFileSync(catalogPath, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
  return catalogPath;
}

/** Delete only the CCRelay-owned catalog file. */
export function removeCodexModelCatalog(codexDir: string = codexConfigDir()): void {
  const catalogPath = codexModelCatalogPath(codexDir);
  if (fs.existsSync(catalogPath)) {
    fs.unlinkSync(catalogPath);
  }
}

export function isCcrelayCatalogPointer(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const base = path.basename(value.trim().replace(/^["']|["']$/g, ""));
  return base === CCRELAY_CODEX_MODEL_CATALOG_FILENAME;
}

export function isCodexPointingAtCcrelay(tomlContent: string): boolean {
  return readTopLevelTomlString(tomlContent, "model_provider") === "ccrelay";
}

/**
 * Ensure top-level model_catalog_json points at the CCRelay catalog filename.
 * Inserts after model_provider when missing; replaces when present.
 */
export function ensureCodexModelCatalogJsonField(tomlContent: string): string {
  const line = `model_catalog_json = "${CCRELAY_CODEX_MODEL_CATALOG_FILENAME}"`;
  const lines = tomlContent.split(/\r?\n/);
  let found = false;
  const out = lines.map(l => {
    if (/^\s*model_catalog_json\s*=/.test(l)) {
      found = true;
      return line;
    }
    return l;
  });
  if (!found) {
    const providerIdx = out.findIndex(l => /^\s*model_provider\s*=/.test(l));
    if (providerIdx >= 0) {
      out.splice(providerIdx + 1, 0, line);
    } else {
      const firstSection = out.findIndex(l => /^\s*\[/.test(l));
      if (firstSection >= 0) {
        out.splice(firstSection, 0, line, "");
      } else {
        out.push(line);
      }
    }
  }
  return out.join("\n");
}

/** Remove model_catalog_json only when it points at the CCRelay-owned filename. */
export function removeOwnedCodexModelCatalogJsonField(tomlContent: string): string {
  const lines = tomlContent.split(/\r?\n/);
  return lines
    .filter(l => {
      const m = l.match(/^\s*model_catalog_json\s*=\s*(.+?)\s*$/);
      if (!m) {
        return true;
      }
      let val = m[1].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return !isCcrelayCatalogPointer(val);
    })
    .join("\n");
}

export function catalogFileExists(codexDir: string = codexConfigDir()): boolean {
  return fs.existsSync(codexModelCatalogPath(codexDir));
}

/**
 * If ~/.codex/config.toml already uses model_provider = ccrelay, rewrite the
 * catalog from the given provider. Leaves unrelated TOML keys (including model) alone.
 */
export function syncCodexCatalogIfConfigured(
  provider: Provider | null | undefined,
  options?: {
    fallbackModel?: string;
    codexDir?: string;
    configPath?: string;
    models?: CodexCatalogModelRef[];
  }
): boolean {
  const codexDir = options?.codexDir ?? codexConfigDir();
  const configPath = options?.configPath ?? path.join(codexDir, "config.toml");
  if (!fs.existsSync(configPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    return false;
  }
  if (!isCodexPointingAtCcrelay(raw)) {
    return false;
  }
  const fallback =
    options?.fallbackModel?.trim() || readTopLevelTomlString(raw, "model")?.trim() || undefined;
  let models = options?.models ?? collectCodexModelsFromProvider(provider, fallback);
  if (options?.models && fallback && !models.some(m => m.slug === fallback)) {
    models = [...models, { slug: fallback, displayName: fallback }];
  }
  if (models.length === 0) {
    return false;
  }
  writeCodexModelCatalog(models, codexDir);
  const updated = ensureCodexModelCatalogJsonField(raw);
  if (updated !== raw) {
    fs.writeFileSync(configPath, updated, "utf-8");
  }
  return true;
}
