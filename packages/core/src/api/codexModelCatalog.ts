/**
 * Codex model catalog generation for ~/.codex/ccrelay-model-catalog.json
 * and model_catalog_json pointer in config.toml.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Provider } from "../types";
import { collectParsedCustomModelsDeduped } from "../converter/models-fallback";

export const CCRELAY_CODEX_MODEL_CATALOG_FILENAME = "ccrelay-model-catalog.json";

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
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

const BASE_INSTRUCTIONS =
  "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.";

/** Minimal Codex catalog entry fields required for /model listing. */
function catalogEntryTemplate(slug: string, displayName: string, priority: number): object {
  /* eslint-disable @typescript-eslint/naming-convention -- Codex catalog JSON uses snake_case */
  return {
    slug,
    display_name: displayName,
    description: displayName,
    base_instructions: BASE_INSTRUCTIONS,
    default_reasoning_level: "high",
    supported_reasoning_levels: [],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 1000 + priority,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    supports_parallel_tool_calls: false,
    supports_image_detail_original: false,
    context_window: DEFAULT_CONTEXT_WINDOW,
    max_context_window: DEFAULT_CONTEXT_WINDOW,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text"],
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

  const push = (slug: string, displayName: string) => {
    const s = slug.trim();
    if (!s || seen.has(s)) {
      return;
    }
    seen.add(s);
    const d = displayName.trim() || s;
    out.push({ slug: s, displayName: d });
  };

  if (provider?.customModelsList && provider.customModelsList.length > 0) {
    for (const parsed of collectParsedCustomModelsDeduped(provider.customModelsList)) {
      push(parsed.id, parsed.displayName);
    }
  } else if (provider?.modelMap && provider.modelMappingEnabled !== false) {
    for (const entry of provider.modelMap) {
      const pattern = entry.pattern?.trim() ?? "";
      if (!pattern || isWildcardPattern(pattern)) {
        continue;
      }
      push(pattern, pattern);
    }
  }

  const fallback = fallbackModel?.trim();
  if (fallback) {
    push(fallback, fallback);
  }

  return out;
}

export function buildCodexModelCatalogJson(models: CodexCatalogModelRef[]): {
  models: object[];
} {
  return {
    models: models.map((m, i) => catalogEntryTemplate(m.slug, m.displayName, i)),
  };
}

export function codexConfigDir(): string {
  return path.join(os.homedir(), ".codex");
}

export function codexModelCatalogPath(codexDir: string = codexConfigDir()): string {
  return path.join(codexDir, CCRELAY_CODEX_MODEL_CATALOG_FILENAME);
}

export function writeCodexModelCatalog(
  models: CodexCatalogModelRef[],
  codexDir: string = codexConfigDir()
): string {
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }
  const catalogPath = codexModelCatalogPath(codexDir);
  const body = buildCodexModelCatalogJson(models);
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
  options?: { fallbackModel?: string; codexDir?: string; configPath?: string }
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
  const models = collectCodexModelsFromProvider(provider, fallback);
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
