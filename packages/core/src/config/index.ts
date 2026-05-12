/**
 * Configuration management for CCRelay
 * Reads configuration from ~/.ccrelay/config.yaml
 * Auto-initializes config file with defaults if not exists
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  RouterConfig,
  Provider,
  ProviderConfigSchema,
  FileConfigSchema,
  type FileConfigInput,
  type ProviderConfigInput,
  type RoutingConfigInput,
  type RouteQueueConfigInput,
  type ConcurrencyConfigInput,
  type ConcurrencyConfig,
  type Retry429Config,
  type DatabaseConfig,
  type RouteQueueConfig,
  type BlockPattern,
  type ForwardRule,
  type BlockRule,
  type WebSearchGlobalConfig,
} from "../types";

const CONFIG_VERSION = "0.2.0";

/** Persisted runtime state beside config.yaml */
const STATE_FILENAME = "state.json";

// Environment variable pattern for substitution
const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

// Default config with comments template
const DEFAULT_CONFIG_YAML = `# CCRelay Configuration
# Docs: https://github.com/inflaborg/ccrelay#configuration
configVersion: "${CONFIG_VERSION}"

# ==================== Server Configuration ====================
server:
  port: 7575                    # Proxy server port
  host: "127.0.0.1"             # Bind address
  autoStart: true               # Auto-start server when extension loads
  # apiBearerToken: (optional — auto-generated and written on first load if omitted)

# ==================== Provider Configuration ====================
providers:
  official:
    name: "Claude Official"
    baseUrl: "https://api.anthropic.com"
    mode: "passthrough"         # passthrough | inject
    providerType: "anthropic"   # anthropic | openai | openai_chat
    enabled: true

  # Example: Custom provider
  # custom:
  #   name: "Custom Provider"
  #   baseUrl: "https://api.example.com/anthropic"
  #   mode: "inject"
  #   providerType: "anthropic"
  #   apiKey: "\${API_KEY}"      # Supports environment variables
  #   authHeader: "authorization"
  #   modelMap:
  #     - { pattern: "claude-*", model: "custom-model" }
  #   model_mapping_enabled: false   # optional: keep maps in config but disable remap (default: true)
  #   enabled: true

# Default provider ID
defaultProvider: "official"

# ==================== Routing Configuration ====================
routing:
  # Forward rules: path → provider mapping. First match wins.
  # provider: "auto" = current active provider; or a specific provider ID.
  # Unmatched paths return 404.
  forward:
    - path: "/v1/messages"
      provider: "auto"
    - path: "/v1/chat/completions"
      provider: "auto"
    - path: "/v1/responses"
      provider: "auto"
    - path: "/v1/models"
      provider: "auto"
    - path: "/v1/messages/count_tokens"
      provider: "auto"
    # OpenAI-prefixed — base URL e.g. http://127.0.0.1:7575/openai (SDK path rewritten upstream)
    - path: "/openai/chat/completions"
      provider: "auto"
    - path: "/openai/responses"
      provider: "auto"
    - path: "/openai/models"
      provider: "auto"
    # Anthropic-prefixed — base URL e.g. http://127.0.0.1:7575/anthropic
    - path: "/anthropic/v1/messages"
      provider: "auto"
    - path: "/anthropic/v1/models"
      provider: "auto"
    - path: "/anthropic/v1/messages/count_tokens"
      provider: "auto"

  # Block rules: return custom response instead of forwarding.
  # Checked before forward. Optional condition.providers: rule applies only when current provider id is in the list (allowlist).
  # Optional condition.providerNot: skip when current id is in the list.
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200
    - path: "/v1/messages/count_tokens"
      response: '{"input_tokens": 0}'
      code: 200
    - path: "/v1/users/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/v1/organizations/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/anthropic/v1/users/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/anthropic/v1/organizations/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200

# ==================== Concurrency Control ====================
concurrency:
  enabled: true                 # Enable concurrency queue
  maxWorkers: 3                 # Maximum concurrent workers
  maxQueueSize: 100             # Maximum queue size (0=unlimited)

  # Request timeout: Maximum wait time in queue (seconds)
  # Requests exceeding this will return 503
  # 0 or not set = unlimited
  requestTimeout: 60

  # 429 Retry configuration
  retry429:
    enabled: false              # Enable automatic retry on 429 responses
    maxRetries: 3               # Maximum retry attempts
    delayMs: 1000               # Delay between retries (milliseconds)

  # Per-route queue configuration
  routes:
    - pattern: "/v1/messages/count_tokens"
      name: "count_tokens"
      maxWorkers: 30
      maxQueueSize: 1000

# ==================== Logging Storage ====================
logging:
  enabled: false                # Enable request log storage

  database:
    type: "sqlite"              # sqlite | postgres
    # SQLite configuration (default)
    path: ""                    # Empty = ~/.ccrelay/logs.db
    # Optional sqlite3 CLI path; empty = resolve from PATH only
    # sqlite3_executable: ""

    # PostgreSQL configuration
    # type: "postgres"
    # host: "localhost"
    # port: 5432
    # name: "ccrelay"
    # user: ""
    # password: "\${POSTGRES_PASSWORD}"
    # ssl: false
`;

/**
 * Default configuration object (parsed from DEFAULT_CONFIG_YAML)
 */
function getDefaultConfig(): FileConfigInput {
  const parsed = yaml.load(DEFAULT_CONFIG_YAML);
  return FileConfigSchema.parse(parsed);
}

/** Bundled forward + block rules from `DEFAULT_CONFIG_YAML` (Settings “restore routing defaults”). */
export function getDefaultRoutingSettings(): {
  forward: ForwardRule[];
  block: BlockRule[];
} {
  const d = getDefaultConfig();
  const r = d.routing;
  return {
    forward: [...(r?.forward ?? [])],
    block: [...(r?.block ?? [])],
  };
}

/**
 * Expand environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function expandEnvVars(value: string): string {
  if (!value || typeof value !== "string") {
    return value;
  }
  return value.replace(ENV_VAR_PATTERN, (_, varName: string) => {
    return process.env[varName] || "";
  });
}

/**
 * Recursively expand environment variables in an object
 * Preserves the structure of the input object
 *
 * @param isProvidersMap — When true, object keys are **not** run through snake→camel, because
 *   those keys are provider **ids** (e.g. `minimax-m2-5_copy`). The previous behavior mangled
 *   `_copy` into `Copy` by turning `_c` into `C`.
 */
export function expandEnvVarsInObject<T>(obj: T, options?: { isProvidersMap?: boolean }): T {
  if (!obj) {
    return obj;
  }
  if (typeof obj === "string") {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    for (const item of obj) {
      out.push(expandEnvVarsInObject(item as never));
    }
    return out as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (options?.isProvidersMap) {
        // Provider ids are arbitrary; never treat them as snake_case field names.
        result[key] = expandEnvVarsInObject(value);
      } else {
        // Convert snake_case to camelCase for config field names (not provider map keys)
        const camelKey = key.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) =>
          letter.toUpperCase()
        );
        const isProvidersObject =
          key === "providers" &&
          value !== null &&
          value !== undefined &&
          typeof value === "object" &&
          !Array.isArray(value);
        result[camelKey] = isProvidersObject
          ? expandEnvVarsInObject(value, { isProvidersMap: true })
          : expandEnvVarsInObject(value);
      }
    }
    return result as T;
  }
  return obj;
}

/**
 * Deep merge two objects (plain nested objects only). Source overwrites target; arrays are atomic.
 *
 * Full config files use {@link mergeFileConfigWithDefaults} so list-shaped sections inherit new
 * default rows without overwriting user-defined lists.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = source[key] as T[keyof T];
      }
    }
  }
  return result;
}

function stableJsonForMergeKey(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return "null";
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableJsonForMergeKey).join(",")}]`;
  }
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort((a, b) => a.localeCompare(b));
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableJsonForMergeKey(o[k])}`).join(",")}}`;
}

function blockRuleMergeKey(rule: Pick<BlockRule, "path" | "condition">): string {
  return `${rule.path}\0${stableJsonForMergeKey(rule.condition ?? null)}`;
}

function cloneRoutingInput(r: RoutingConfigInput): RoutingConfigInput {
  return {
    ...r,
    ...(r.forward?.length ? { forward: r.forward.map(x => ({ ...x })) } : {}),
    ...(r.block?.length ? { block: r.block.map(x => ({ ...x })) } : {}),
  };
}

/**
 * Keeps user's list order. When `userRules === undefined`, use defaults alone. When user lists an empty
 * array, treat it as intentional (do not attach defaults).
 */
function mergeForwardRuleLists(
  defaultRules: ForwardRule[],
  userRules: ForwardRule[] | undefined
): ForwardRule[] {
  if (userRules === undefined) {
    return defaultRules.map(r => ({ ...r }));
  }
  if (userRules.length === 0) {
    return [];
  }
  const paths = new Set(userRules.map(r => r.path));
  const out = userRules.map(r => ({ ...r }));
  for (const r of defaultRules) {
    if (!paths.has(r.path)) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Same semantics as {@link mergeForwardRuleLists}: undefined = defaults; [] = intentional empty list. */
function mergeBlockRuleLists(
  defaultRules: BlockRule[],
  userRules: BlockRule[] | undefined
): BlockRule[] {
  if (userRules === undefined) {
    return defaultRules.map(r => ({ ...r }));
  }
  if (userRules.length === 0) {
    return [];
  }
  const keys = new Set(userRules.map(blockRuleMergeKey));
  const out = userRules.map(r => ({ ...r }));
  for (const r of defaultRules) {
    if (!keys.has(blockRuleMergeKey(r))) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Discriminant: `pattern` (queue route). Undefined = inherit default routes; [] = explicit empty. */
function mergeRouteQueueLists(
  defaultRoutes: RouteQueueConfigInput[],
  userRoutes: RouteQueueConfigInput[] | undefined
): RouteQueueConfigInput[] | undefined {
  if (userRoutes === undefined) {
    if (defaultRoutes.length === 0) {
      return undefined;
    }
    return defaultRoutes.map(r => ({ ...r }));
  }
  if (userRoutes.length === 0) {
    return [];
  }
  const patterns = new Set(userRoutes.map(r => r.pattern));
  const out = userRoutes.map(r => ({ ...r }));
  for (const r of defaultRoutes) {
    if (!patterns.has(r.pattern)) {
      out.push({ ...r });
    }
  }
  return out;
}

/** Default provider ids preserved; overlapping ids merge recursively. */
function mergeProviderRecords(
  defaults: Record<string, ProviderConfigInput>,
  user: Record<string, ProviderConfigInput>
): Record<string, ProviderConfigInput> {
  const out: Record<string, ProviderConfigInput> = { ...defaults };
  for (const id of Object.keys(user)) {
    const d = defaults[id];
    const u = user[id];
    if (d && u) {
      out[id] = deepMerge(
        { ...(d as Record<string, unknown>) },
        u as Partial<Record<string, unknown>>
      ) as ProviderConfigInput;
    } else {
      out[id] = u;
    }
  }
  return out;
}

function mergeRoutingInputs(
  d: RoutingConfigInput | undefined,
  f: RoutingConfigInput | undefined
): RoutingConfigInput | undefined {
  if (!f) {
    return d ? cloneRoutingInput(d) : undefined;
  }
  if (!d) {
    return cloneRoutingInput(f);
  }
  return {
    forward: mergeForwardRuleLists(d.forward ?? [], f.forward),
    block: mergeBlockRuleLists(d.block ?? [], f.block),
    proxy: f.proxy,
    passthrough: f.passthrough,
    openaiBlock: f.openaiBlock,
  };
}

function mergeConcurrencyInputs(
  d: ConcurrencyConfigInput | undefined,
  f: ConcurrencyConfigInput | undefined
): ConcurrencyConfigInput | undefined {
  if (!f) {
    return d ? { ...d } : undefined;
  }
  if (!d) {
    return { ...f };
  }
  const dr = d.routes;
  const fr = f.routes;
  const dRest = { ...d };
  delete (dRest as Partial<ConcurrencyConfigInput> & Record<string, unknown>).routes;
  const fRest = { ...f };
  delete (fRest as Partial<ConcurrencyConfigInput> & Record<string, unknown>).routes;
  const mergedRest = deepMerge(
    dRest as Record<string, unknown>,
    fRest as Partial<Record<string, unknown>>
  ) as Omit<ConcurrencyConfigInput, "routes">;
  const routes = mergeRouteQueueLists(dr ?? [], fr);
  return { ...mergedRest, routes };
}

/**
 * Merge bundled defaults with disk config: wherever the user omitted a scalar/object field, defaults
 * apply; list sections (`routing.forward` / `routing.block` / `concurrency.routes`) keep user rows
 * first and append default rows not already present (by `path` / block key / `pattern`). `undefined`
 * list = use defaults; empty array = user explicitly chose no entries.
 */
export function mergeFileConfigWithDefaults(
  defaults: FileConfigInput,
  file: Partial<FileConfigInput>
): FileConfigInput {
  const routing = mergeRoutingInputs(defaults.routing, file.routing);

  let providers: Record<string, ProviderConfigInput> | undefined;
  if (!defaults.providers && !file.providers) {
    providers = undefined;
  } else if (!file.providers) {
    providers = defaults.providers ? { ...defaults.providers } : undefined;
  } else if (!defaults.providers) {
    providers = { ...file.providers };
  } else {
    providers = mergeProviderRecords(defaults.providers, file.providers);
  }

  const merged: FileConfigInput = {
    configVersion:
      file.configVersion !== undefined && file.configVersion !== null
        ? file.configVersion
        : defaults.configVersion,
    defaultProvider:
      file.defaultProvider !== undefined ? file.defaultProvider : defaults.defaultProvider,
    server:
      (defaults.server ?? file.server)
        ? (deepMerge(
            (defaults.server ?? {}) as Record<string, unknown>,
            (file.server ?? {}) as Record<string, unknown>
          ) as unknown as FileConfigInput["server"])
        : undefined,
    providers,
    routing,
    concurrency: mergeConcurrencyInputs(defaults.concurrency, file.concurrency),
    logging:
      (defaults.logging ?? file.logging)
        ? (deepMerge(
            (defaults.logging ?? {}) as Record<string, unknown>,
            (file.logging ?? {}) as Record<string, unknown>
          ) as unknown as FileConfigInput["logging"])
        : undefined,
    webSearch: file.webSearch ?? file.web_search ?? defaults.webSearch,
  };

  return merged;
}

/**
 * Expand ~ to home directory in path
 */
function expandPath(filepath: string): string {
  if (filepath.startsWith("~")) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * Parse provider from validated config
 */
function parseProvider(id: string, config: ProviderConfigInput): Provider {
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

function generateApiBearerToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class ConfigManager {
  private config: RouterConfig;
  private configPath: string;
  private statePath: string;
  private configChangeCallbacks: Set<() => void> = new Set();

  // File watcher state
  private fileWatcher: fs.FSWatcher | null = null;
  private fileWatchDebounce: NodeJS.Timeout | null = null;
  private saving = false;

  constructor() {
    this.configPath = expandPath(path.join(os.homedir(), ".ccrelay", "config.yaml"));
    this.statePath = path.join(os.homedir(), ".ccrelay", STATE_FILENAME);

    // Ensure config file exists with defaults
    this.ensureConfigFile();

    // Load configuration (ensures Bearer token persisted if missing)
    this.config = this.loadConfig();

    // Watch the YAML config file for external edits
    this.startFileWatcher();
  }

  /**
   * Start watching the config YAML file for external changes
   */
  private startFileWatcher(): void {
    this.stopFileWatcher();

    if (!fs.existsSync(this.configPath)) {
      return;
    }

    try {
      this.fileWatcher = fs.watch(this.configPath, () => {
        if (this.saving) {
          return;
        }
        if (this.fileWatchDebounce) {
          clearTimeout(this.fileWatchDebounce);
        }
        this.fileWatchDebounce = setTimeout(() => {
          this.fileWatchDebounce = null;
          console.log("[ConfigManager] Config file changed externally, reloading...");
          this.reload();
        }, 300);
      });
    } catch {
      // fs.watch may fail on some platforms; non-critical
    }
  }

  /**
   * Stop watching the config YAML file
   */
  private stopFileWatcher(): void {
    if (this.fileWatchDebounce) {
      clearTimeout(this.fileWatchDebounce);
      this.fileWatchDebounce = null;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  /**
   * Write server.apiBearerToken into config.yaml preserving other keys.
   */
  private writeServerBearerToDisk(token: string): void {
    try {
      const raw = fs.existsSync(this.configPath)
        ? ((yaml.load(fs.readFileSync(this.configPath, "utf-8")) as Record<string, unknown>) ?? {})
        : {};
      const prevServer =
        raw.server && typeof raw.server === "object" && !Array.isArray(raw.server)
          ? { ...(raw.server as Record<string, unknown>) }
          : {};
      prevServer.apiBearerToken = token;
      raw.server = prevServer;

      const yamlContent = yaml.dump(raw, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;
      console.warn("[ConfigManager] Wrote server.apiBearerToken after missing merge result");
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] writeServerBearerToDisk failed:", err);
    }
  }

  /**
   * If config.yaml lacks server.apiBearerToken, generate one and persist.
   */
  private ensureBearerTokenPersisted(): void {
    if (!fs.existsSync(this.configPath)) {
      return;
    }
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const raw = yaml.load(content) as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object") {
        return;
      }

      let serverRaw = raw.server;
      let serverObj: Record<string, unknown>;
      if (serverRaw && typeof serverRaw === "object" && !Array.isArray(serverRaw)) {
        serverObj = { ...(serverRaw as Record<string, unknown>) };
      } else {
        serverObj = {};
        raw.server = serverObj;
      }

      const existing =
        typeof serverObj.apiBearerToken === "string" ? serverObj.apiBearerToken.trim() : "";
      if (existing.length > 0) {
        return;
      }

      serverObj.apiBearerToken = generateApiBearerToken();
      raw.server = serverObj;

      const yamlContent = yaml.dump(raw, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;
      console.log("[ConfigManager] Generated server.apiBearerToken and persisted to config.yaml");
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] ensureBearerTokenPersisted failed:", err);
    }
  }

  /**
   * Ensure config file exists, create with defaults if not
   */
  private ensureConfigFile(): void {
    const configDir = path.dirname(this.configPath);

    // Create directory if not exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Create config file if not exists
    if (!fs.existsSync(this.configPath)) {
      console.log(`[ConfigManager] Creating default config at ${this.configPath}`);
      fs.writeFileSync(this.configPath, DEFAULT_CONFIG_YAML, "utf-8");
      return;
    }

    // File exists — only back-fill keys that are completely absent (e.g. new version fields).
    // Never overwrite user values; the disk file is the source of truth.
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const existingConfig = yaml.load(content) as Record<string, unknown> | null;

      if (!existingConfig || typeof existingConfig !== "object") {
        return;
      }

      const defaults = yaml.load(DEFAULT_CONFIG_YAML) as Record<string, unknown>;
      let changed = false;

      for (const key of Object.keys(defaults)) {
        if (!(key in existingConfig)) {
          // Top-level key missing entirely — copy from defaults
          existingConfig[key] = defaults[key];
          changed = true;
        } else if (
          typeof defaults[key] === "object" &&
          defaults[key] !== null &&
          !Array.isArray(defaults[key]) &&
          typeof existingConfig[key] === "object" &&
          existingConfig[key] !== null &&
          !Array.isArray(existingConfig[key])
        ) {
          // Both are objects — only add sub-keys that are missing
          const defObj = defaults[key] as Record<string, unknown>;
          const existObj = existingConfig[key] as Record<string, unknown>;
          for (const subKey of Object.keys(defObj)) {
            if (!(subKey in existObj)) {
              existObj[subKey] = defObj[subKey];
              changed = true;
            }
          }
        }
      }

      if (changed) {
        console.log(`[ConfigManager] Back-filled missing fields in ${this.configPath}`);
        const yamlContent = yaml.dump(existingConfig, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        this.saving = true;
        fs.writeFileSync(this.configPath, yamlContent, "utf-8");
        this.saving = false;
      }
    } catch (err) {
      console.error(`[ConfigManager] Error reading config file:`, err);
    }
  }

  /**
   * Load and parse configuration from yaml file
   */
  private loadConfig(): RouterConfig {
    console.log(`[ConfigManager] Loading config from ${this.configPath}`);

    // Persist API bearer if missing before reading merged config from disk
    this.ensureBearerTokenPersisted();

    // Load from file
    let fileConfig: FileConfigInput = {};
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf-8");
        const rawConfig = yaml.load(content);
        if (rawConfig && typeof rawConfig === "object") {
          const expanded = expandEnvVarsInObject(rawConfig);
          const result = FileConfigSchema.safeParse(expanded);
          if (result.success) {
            fileConfig = result.data;
          } else {
            console.warn("[ConfigManager] Config validation failed:", result.error.format());
          }
        }
      }
    } catch (err) {
      console.error(`[ConfigManager] Failed to load config:`, err);
    }

    // Merge with defaults
    const defaults = getDefaultConfig();
    const merged = mergeFileConfigWithDefaults(defaults, fileConfig);

    // Build providers map
    const providers: Record<string, Provider> = {};
    if (merged.providers) {
      for (const [id, config] of Object.entries(merged.providers)) {
        const result = ProviderConfigSchema.safeParse(config);
        if (result.success) {
          providers[id] = parseProvider(id, result.data);
        } else {
          console.warn(`[ConfigManager] Provider ${id} validation failed:`, result.error.format());
        }
      }
    }

    // Ensure official provider exists
    if (!providers.official) {
      providers.official = {
        id: "official",
        name: "Claude Official",
        baseUrl: "https://api.anthropic.com",
        mode: "passthrough",
        providerType: "anthropic",
        headers: {},
        enabled: true,
      };
    }

    // Build concurrency config
    let concurrency: ConcurrencyConfig | undefined;
    if (merged.concurrency?.enabled) {
      // Build retry429 config with defaults
      let retry429: Retry429Config | undefined;
      if (merged.concurrency.retry429) {
        retry429 = {
          enabled: merged.concurrency.retry429.enabled ?? false,
          maxRetries: merged.concurrency.retry429.maxRetries ?? 3,
          delayMs: merged.concurrency.retry429.delayMs ?? 1000,
        };
      } else {
        // Default retry429 config
        retry429 = {
          enabled: false,
          maxRetries: 3,
          delayMs: 1000,
        };
      }

      concurrency = {
        enabled: true,
        maxWorkers: merged.concurrency.maxWorkers || 3,
        maxQueueSize: merged.concurrency.maxQueueSize,
        requestTimeout: merged.concurrency.requestTimeout,
        retry429,
      };
    }

    // Build route queues config
    let routeQueues: RouteQueueConfig[] | undefined;
    const routes = merged.concurrency?.routes;
    if (routes && routes.length > 0) {
      routeQueues = routes.map((route, index) => {
        let compiledPattern: RegExp;
        try {
          compiledPattern = new RegExp(route.pattern);
        } catch {
          console.warn(
            `[ConfigManager] Invalid regex pattern "${route.pattern}" at index ${index}`
          );
          compiledPattern = /^$/; // Match nothing on error
        }
        return {
          pattern: route.pattern,
          maxWorkers: route.maxWorkers ?? 10,
          maxQueueSize: route.maxQueueSize,
          requestTimeout: route.requestTimeout,
          name: route.name,
          compiledPattern,
        };
      });
    }

    // Build database config
    let database: DatabaseConfig | undefined;
    if (merged.logging?.enabled && merged.logging?.database) {
      const db = merged.logging.database;
      if (db.type === "postgres") {
        database = {
          type: "postgres",
          host: db.host || "localhost",
          port: db.port || 5432,
          name: db.name || "ccrelay",
          user: db.user || "",
          password: db.password,
          ssl: db.ssl ?? false,
        };
      } else {
        const exe = typeof db.sqlite3Executable === "string" ? db.sqlite3Executable.trim() : "";
        database = {
          type: "sqlite",
          path: db.path || undefined,
          ...(exe ? { sqlite3Executable: exe } : {}),
        };
      }
    }

    // Build routing config — check version to decide whether migration is needed
    // Read raw YAML to get the actual file content (before merge with defaults)
    const rawFileObj = ((): Record<string, unknown> => {
      try {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        return (yaml.load(raw) as Record<string, unknown>) ?? {};
      } catch {
        return {};
      }
    })();
    const fileConfigVersion =
      typeof rawFileObj.configVersion === "string" ? rawFileObj.configVersion : null;
    const needsMigration = !fileConfigVersion;

    const rawRouting = merged.routing ?? {};
    let forwardRules: ForwardRule[];
    let blockRules: BlockRule[];

    if (!needsMigration) {
      // Current version — use merged config directly
      forwardRules = (rawRouting.forward ?? []).map((f: { path: string; provider: string }) => ({
        path: f.path,
        provider: f.provider,
      }));
      blockRules = (rawRouting.block ?? []).map(
        (b): BlockRule => ({
          path: b.path,
          condition: b.condition,
          response: b.response,
          code: b.code,
        })
      );
    } else {
      // Legacy config (no configVersion) — migrate routing format
      const proxy: string[] = rawRouting.proxy ?? [
        "/v1/messages",
        "/v1/chat/completions",
        "/v1/models",
        "/v1/responses",
      ];
      forwardRules = [...proxy.map((p: string) => ({ path: p, provider: "auto" }))];
      const legacyBlock: BlockPattern[] = (rawRouting.block || []).map(
        (b: { path: string; response?: string; code?: number }): BlockPattern => ({
          path: b.path,
          response: b.response || "",
          code: b.code ?? 200,
        })
      );
      const legacyOpenaiBlock: BlockPattern[] = (rawRouting.openaiBlock || []).map(
        (b: { path: string; response?: string; code?: number }): BlockPattern => ({
          path: b.path,
          response: b.response || "",
          code: b.code ?? 200,
        })
      );
      const defaultPassthroughGuard = ["/v1/users/*", "/v1/organizations/*"];
      const passthroughRaw = rawRouting.passthrough;
      let passthroughPaths: string[] = Array.isArray(passthroughRaw)
        ? passthroughRaw.filter((x): x is string => typeof x === "string")
        : defaultPassthroughGuard;
      if (passthroughPaths.length === 0) {
        passthroughPaths = defaultPassthroughGuard;
      }
      const legacyPassthroughGuard: BlockRule[] = passthroughPaths.map((globPath: string) => ({
        path: globPath,
        condition: { providerNot: ["official"] },
        response: "",
        code: 200,
      }));

      blockRules = [
        ...legacyBlock.map((b: BlockPattern) => ({
          path: b.path,
          response: b.response,
          code: b.code ?? 200,
        })),
        ...legacyOpenaiBlock.map((b: BlockPattern) => ({
          path: b.path,
          response: b.response,
          code: b.code ?? 200,
        })),
        ...legacyPassthroughGuard,
        {
          path: "/anthropic/v1/users/*",
          condition: { providerNot: ["official"] },
          response: "",
          code: 200,
        },
        {
          path: "/anthropic/v1/organizations/*",
          condition: { providerNot: ["official"] },
          response: "",
          code: 200,
        },
      ];

      const defRt = getDefaultConfig().routing;
      forwardRules = mergeForwardRuleLists(defRt?.forward ?? [], forwardRules);
      blockRules = mergeBlockRuleLists(defRt?.block ?? [], blockRules);

      // Write migrated config back to disk with version stamp
      try {
        merged.configVersion = CONFIG_VERSION;
        merged.routing = { forward: forwardRules, block: blockRules };
        const writeTarget = { ...rawFileObj, ...merged };
        if (writeTarget.routing) {
          delete writeTarget.routing.proxy;
          delete writeTarget.routing.passthrough;
          delete writeTarget.routing.openaiBlock;
        }
        const yamlContent = yaml.dump(writeTarget, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        this.saving = true;
        fs.writeFileSync(this.configPath, yamlContent, "utf-8");
        this.saving = false;
        console.log(`[ConfigManager] Migrated config to version ${CONFIG_VERSION}`);
      } catch (err) {
        this.saving = false;
        console.error("[ConfigManager] Failed to write migrated config:", err);
      }
    }

    const routing = { forward: forwardRules, block: blockRules };

    let apiBearerTok =
      typeof merged.server?.apiBearerToken === "string" ? merged.server.apiBearerToken.trim() : "";
    if (apiBearerTok.length === 0) {
      apiBearerTok = generateApiBearerToken();
      this.writeServerBearerToDisk(apiBearerTok);
    }

    // Build global web search config

    function computeGlmEndpoint(
      protocol: "anthropic" | "openai",
      region: "intl" | "cn",
      coding: boolean
    ): string {
      const host = region === "cn" ? "https://open.bigmodel.cn" : "https://api.z.ai";
      if (protocol === "anthropic") {
        return `${host}/api/anthropic`;
      }
      const planPath = coding ? "/api/coding/paas/v4" : "/api/paas/v4";
      return `${host}${planPath}/chat/completions`;
    }

    const rawWebSearch = merged.webSearch ?? merged.web_search;
    let webSearchConfig: WebSearchGlobalConfig | undefined;
    if (rawWebSearch) {
      const t = rawWebSearch.tavily;
      const g = rawWebSearch.glm;
      const providers = Array.isArray(rawWebSearch.providers) ? rawWebSearch.providers : undefined;
      const defaultSearchBackend =
        typeof rawWebSearch.defaultSearchBackend === "string"
          ? rawWebSearch.defaultSearchBackend
          : undefined;
      if (t || g || providers || defaultSearchBackend) {
        let glmConfig: WebSearchGlobalConfig["glm"] | undefined;
        if (g) {
          const protocol = g.protocol === "anthropic" ? "anthropic" : "openai";
          const region = g.region === "cn" ? "cn" : "intl";
          const coding = g.coding === true;
          const computedEndpoint = computeGlmEndpoint(protocol, region, coding);
          glmConfig = {
            apiKey: g.apiKey ?? g.api_key,
            endpoint:
              typeof g.endpoint === "string" && g.endpoint.length > 0
                ? g.endpoint
                : computedEndpoint,
            protocol,
            region,
            coding,
            model: g.model,
          };
        }
        webSearchConfig = {
          ...(t
            ? {
                tavily: {
                  apiKey: t.apiKey ?? t.api_key,
                  searchDepth: t.searchDepth ?? t.search_depth,
                  maxResults: t.maxResults ?? t.max_results,
                },
              }
            : {}),
          ...(glmConfig ? { glm: glmConfig } : {}),
          ...(providers && providers.length > 0 ? { providers } : {}),
          ...(defaultSearchBackend ? { defaultSearchBackend } : {}),
        };
      }
    }

    return {
      port: merged.server?.port || 7575,
      host: merged.server?.host || "127.0.0.1",
      autoStart: merged.server?.autoStart ?? true,
      apiBearerToken: apiBearerTok,
      defaultProvider: merged.defaultProvider || "official",
      providers,
      routing,
      concurrency,
      routeQueues,
      logging: {
        enabled: merged.logging?.enabled ?? false,
        database,
      },
      locale: merged.server?.locale,
      webSearch: webSearchConfig,
    };
  }

  /**
   * Register a callback for config changes
   */
  onConfigChanged(callback: () => void): void {
    this.configChangeCallbacks.add(callback);
  }

  /**
   * Unregister a config change callback
   */
  offConfigChanged(callback: () => void): void {
    this.configChangeCallbacks.delete(callback);
  }

  /**
   * Notify all registered config change listeners
   */
  private notifyConfigChanged(): void {
    for (const callback of this.configChangeCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    console.log("[ConfigManager] Reloading configuration...");
    this.ensureConfigFile();
    this.config = this.loadConfig();
    this.notifyConfigChanged();
  }

  get configValue(): RouterConfig {
    return this.config;
  }

  get providers(): Record<string, Provider> {
    return this.config.providers;
  }

  get enabledProviders(): Provider[] {
    return Object.values(this.config.providers).filter(p => p.enabled !== false);
  }

  getProvider(id: string): Provider | undefined {
    return this.config.providers[id];
  }

  get defaultProvider(): string {
    // Ensure default provider exists
    if (this.config.providers[this.config.defaultProvider]) {
      return this.config.defaultProvider;
    }
    // Fall back to first available provider
    const available = Object.keys(this.config.providers);
    if (available.length > 0) {
      return available[0];
    }
    return "official";
  }

  /**
   * Secret for authenticated /ccrelay/api reads (timing-safe comparisons use buffers).
   */
  getApiBearerToken(): string {
    return this.config.apiBearerToken;
  }

  get port(): number {
    return this.config.port;
  }

  get host(): string {
    return this.config.host;
  }

  get autoStart(): boolean {
    return this.config.autoStart;
  }

  get locale(): string | undefined {
    return this.config.locale;
  }

  get routing() {
    return this.config.routing;
  }

  get forwardRules(): ForwardRule[] {
    return this.config.routing.forward;
  }

  get blockRules(): BlockRule[] {
    return this.config.routing.block;
  }

  get concurrencyConfig(): ConcurrencyConfig | undefined {
    return this.config.concurrency;
  }

  get routeQueues(): RouteQueueConfig[] | undefined {
    return this.config.routeQueues;
  }

  get database(): DatabaseConfig | undefined {
    return this.config.logging.database;
  }

  get enableLogStorage(): boolean {
    return this.config.logging.enabled;
  }

  get webSearchConfig(): WebSearchGlobalConfig | undefined {
    return this.config.webSearch;
  }

  /**
   * Get the current provider ID from ~/.ccrelay/state.json
   */
  getCurrentProviderId(): string {
    const persisted = this.readPersistedCurrentProviderId();
    if (persisted && this.config.providers[persisted]) {
      return persisted;
    }
    return this.defaultProvider;
  }

  /**
   * Persist current provider ID to ~/.ccrelay/state.json
   */
  async setCurrentProviderId(id: string): Promise<void> {
    const dir = path.dirname(this.statePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.statePath,
      JSON.stringify({ currentProvider: id }, null, 2),
      "utf-8"
    );
  }

  /** Read persisted provider id from state file (sync); ignores invalid JSON */
  private readPersistedCurrentProviderId(): string | undefined {
    try {
      if (!fs.existsSync(this.statePath)) {
        return undefined;
      }
      const raw = JSON.parse(fs.readFileSync(this.statePath, "utf-8")) as {
        currentProvider?: unknown;
      };
      return typeof raw.currentProvider === "string" ? raw.currentProvider : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Check if config file exists
   */
  configExists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Add a new provider to the config file
   */
  addProvider(id: string, config: ProviderConfigInput): boolean {
    try {
      // Validate the provider config
      const result = ProviderConfigSchema.safeParse(config);
      if (!result.success) {
        console.error("[ConfigManager] Provider validation failed:", result.error.format());
        return false;
      }

      // Read current file content
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      // Ensure providers object exists
      if (!rawConfig.providers) {
        rawConfig.providers = {};
      }

      // Add the new provider (use snake_case for file)
      const providers = rawConfig.providers as Record<string, ProviderConfigInput>;
      providers[id] = {
        name: config.name,
        baseUrl: config.baseUrl,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        base_url: config.base_url,
        mode: config.mode,
        providerType: config.providerType,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        provider_type: config.provider_type,
        apiKey: config.apiKey,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        api_key: config.api_key,
        authHeader: config.authHeader,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        auth_header: config.auth_header,
        modelMap: config.modelMap,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        model_map: config.model_map,
        vlModelMap: config.vlModelMap,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vl_model_map: config.vl_model_map,
        headers: config.headers,
        enabled: id === "official" ? true : (config.enabled ?? true),
        useCustomModelsList: config.useCustomModelsList,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
        use_custom_models_list: config.use_custom_models_list,
        customModelsList: config.customModelsList,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
        custom_models_list: config.custom_models_list,
        ...(config.modelMappingEnabled !== undefined || config.model_mapping_enabled !== undefined
          ? {
              modelMappingEnabled: config.modelMappingEnabled,
              // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
              model_mapping_enabled: config.model_mapping_enabled,
            }
          : {}),
        ...(config.openaiCompat !== undefined
          ? {
              openaiCompat: config.openaiCompat,
              // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
              openai_compat: config.openai_compat,
            }
          : {}),
      };

      rawConfig.providers = sortProviderMapKeys(providers);

      // Write back to file
      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      // Reload in-memory config
      this.reload();

      return true;
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] Failed to add provider:", err);
      return false;
    }
  }

  /**
   * Delete a provider from the config file
   */
  deleteProvider(id: string): boolean {
    try {
      // Read current file content
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      const providers = rawConfig.providers as Record<string, unknown> | undefined;
      if (!providers) {
        console.error(`[ConfigManager] Provider "${id}" not found (no providers map)`);
        return false;
      }

      const keys = Object.keys(providers);
      const resolved = resolveProviderKeyInMap(keys, id);
      if (!resolved) {
        console.error(`[ConfigManager] Provider "${id}" not found in config file`);
        return false;
      }

      if (resolved === "official") {
        console.error("[ConfigManager] Cannot delete the official provider");
        return false;
      }

      // Delete the provider
      delete providers[resolved];

      // If deleted provider was default, update default to official
      const dfp = rawConfig.defaultProvider;
      if (dfp !== undefined && dfp !== null) {
        const dfpStr = typeof dfp === "string" || typeof dfp === "number" ? String(dfp) : null;
        if (dfpStr) {
          const defKey =
            resolveProviderKeyInMap(keys, dfpStr) ?? (keys.includes(dfpStr) ? dfpStr : null);
          if (defKey === resolved) {
            rawConfig.defaultProvider = "official";
          }
        }
      }

      rawConfig.providers = sortProviderMapKeys(providers);

      // Write back to file
      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      // Reload in-memory config
      this.reload();

      return true;
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] Failed to delete provider:", err);
      return false;
    }
  }

  /**
   * Like getConfigRaw but redacts secrets for GET /ccrelay/api/config responses.
   */
  getConfigRawForApi(): Record<string, unknown> {
    const raw = this.getConfigRaw();
    const serverRaw = raw.server as Record<string, unknown> | undefined;
    let serverClone: Record<string, unknown>;

    if (serverRaw && typeof serverRaw === "object" && !Array.isArray(serverRaw)) {
      serverClone = { ...serverRaw };
      if ("apiBearerToken" in serverClone) {
        serverClone.apiBearerToken = "<redacted>";
      }
    } else {
      serverClone = {};
    }

    return {
      ...raw,
      server: serverClone,
    };
  }

  /**
   * Read the raw YAML config and return only the settings sections
   * (excludes providers and defaultProvider).
   */
  getConfigRaw(): Record<string, unknown> {
    const content = fs.readFileSync(this.configPath, "utf-8");
    const raw = yaml.load(content) as Record<string, unknown>;
    return {
      logging: raw.logging ?? {},
      concurrency: raw.concurrency ?? {},
      server: raw.server ?? {},
      routing: raw.routing ?? {},
      webSearch: raw.webSearch ?? raw.web_search ?? {},
    };
  }

  /**
   * Deep-merge `data` into `rawConfig[section]` and write the YAML back (`merge`: default true).
   * When `merge` is false, `data` replaces the section entirely (used for routing reset).
   * Only the four settings sections are allowed.
   */
  updateConfigSection(
    section: "logging" | "concurrency" | "server" | "routing" | "webSearch",
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): { ok: boolean; error?: string } {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      const merge = options?.merge !== false;
      const existing = (rawConfig[section] as Record<string, unknown>) ?? {};
      rawConfig[section] = merge ? deepMerge(existing, data) : data;

      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      this.reload();
      return { ok: true };
    } catch (err) {
      this.saving = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ConfigManager] Failed to update ${section}:`, err);
      return { ok: false, error: msg };
    }
  }

  dispose(): void {
    this.stopFileWatcher();
  }
}
